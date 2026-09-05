"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { DoublageShareButtons } from "@/components/DoublageShareButtons";
import type { RecordingResult } from "@/components/VoiceRecorder";
import {
  computeNextPollDelayMs,
  isTerminalDoublageStatus,
  shouldTriggerDownload,
  validateDoublageRequest,
  type DoublageJobView,
} from "@/lib/doublageClient";
import { MON_ESPACE_HISTORIQUE_PATH } from "@/lib/doublageSauvegardeClient";
import type { DoublageMixMode } from "@/lib/ffmpegCommand";

/**
 * Génération et téléchargement du fichier de doublage — ST 3.1 (US 3.1 :
 * « quand je clique sur télécharger, un fichier vidéo intégrant l'extrait
 * original et ma voix est généré et téléchargé »).
 *
 * Flux : `POST /api/doublages` (multipart : blob voix + `extraitId`) →
 * polling de `GET /api/doublages/:id` avec back-off (`computeNextPollDelayMs`)
 * → au passage à `pret`, déclenchement automatique du téléchargement via un
 * `<a download>` synthétique (`shouldTriggerDownload`).
 *
 * Ce composant ne pilote ni `VideoPlayer` ni `VoiceRecorder` : il reçoit le
 * `RecordingResult` déjà produit par `VoiceRecorder` (même principe de
 * remontée d'état par le parent que `currentVideoTime`, cf. ST 2.1).
 *
 * ST 10.4 (tâche 3, « vérifier l'enchaînement avec le partage et la
 * sauvegarde privée ») : `POST /api/doublages/:id/sauvegarder` (ST 6.1)
 * existait déjà côté serveur mais n'était relié à aucun bouton — ajouté
 * ici, sur le même modèle que `publishShare`/`DoublageShareButtons` (ST
 * 3.2), sauf qu'il ne réclame pas de compte : le bouton n'est rendu que si
 * `connecte` (visiteur non connecté ⇒ pas de sauvegarde possible, cf.
 * `authGuard.ts`/`readActiveSessionFromCookieStore`).
 *
 * Points d'injection pour les tests (mêmes conventions que `VoiceRecorder` /
 * `VideoPlayer`) : `fetchImpl`, `schedulePoll`, `triggerDownload`.
 */
export interface DoublageExportProps {
  extraitId: string;
  extraitTitre: string;
  recording: RecordingResult | null;
  mode?: DoublageMixMode;
  style?: CSSProperties;
  /**
   * Compte connecté ou non (ST 6.1 exige un compte pour sauvegarder un
   * doublage, contrairement à l'export/le partage — cf. cahier des
   * charges « aucun compte n'est nécessaire pour doubler, télécharger ou
   * partager »). Défaut `false` : bouton masqué tant que l'état de session
   * n'est pas connu, pour ne jamais l'afficher à tort à un visiteur anonyme.
   */
  connecte?: boolean;
  /** `fetch` injectable (indisponible / à mocker en test). */
  fetchImpl?: typeof fetch;
  /** Planificateur du prochain poll — défaut `setTimeout`. Injecté pour contrôler le temps en test. */
  schedulePoll?: (callback: () => void, delayMs: number) => number;
  /** Annulation d'un poll planifié — défaut `clearTimeout`. */
  cancelPoll?: (handle: number) => void;
  /** Déclenche le téléchargement du fichier — défaut : `<a download>` synthétique. */
  triggerDownload?: (url: string, filename: string) => void;
  onStatusChange?: (job: DoublageJobView) => void;
}

type UiState = "idle" | "submitting" | "processing" | "done" | "error";

/** Disposition interne du bloc résultat (l'habillage vient de `Card`). */
const PANEL_BODY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

function defaultTriggerDownload(url: string, filename: string): void {
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function DoublageExport({
  extraitId,
  extraitTitre,
  recording,
  mode,
  style,
  connecte = false,
  fetchImpl,
  schedulePoll,
  cancelPoll,
  triggerDownload,
  onStatusChange,
}: DoublageExportProps) {
  const [uiState, setUiState] = useState<UiState>("idle");
  const [job, setJob] = useState<DoublageJobView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Partage (ST 3.2) : `shareUrl` renseigné après `POST /api/doublages/:id/partage`.
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // Sauvegarde privée (ST 6.1) : idempotente côté serveur, `sauvegardeId`
  // renseigné après `POST /api/doublages/:id/sauvegarder` (créée ou déjà
  // existante — les deux réponses sont traitées de la même façon ici).
  const [sauvegardeId, setSauvegardeId] = useState<string | null>(null);
  const [sauvegardePending, setSauvegardePending] = useState(false);
  const [sauvegardeError, setSauvegardeError] = useState<string | null>(null);

  const jobRef = useRef<DoublageJobView | null>(null);
  const pollHandleRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);

  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const schedule =
    schedulePoll ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown as number);
  const cancel = cancelPoll ?? ((h: number) => clearTimeout(h));
  const download = triggerDownload ?? defaultTriggerDownload;

  // `cancel` peut changer d'identité à chaque rendu (fabrique par défaut) : on
  // en garde la dernière version dans une ref pour que l'effet de démontage
  // reste à dépendances vides (sinon son *cleanup* se rejouerait à chaque
  // rendu et couperait le polling en cours via `cancelledRef`).
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  const clearPendingPoll = useCallback(() => {
    if (pollHandleRef.current !== null) {
      cancelRef.current(pollHandleRef.current);
      pollHandleRef.current = null;
    }
  }, []);

  // Nettoyage au démontage uniquement : ne pas laisser un poll planifié
  // rappeler `setState` sur un composant démonté (même précaution que les
  // `clearTimeout` de `VoiceRecorder`).
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearPendingPoll();
    };
  }, [clearPendingPoll]);

  const applyJob = useCallback(
    (next: DoublageJobView) => {
      const previous = jobRef.current;
      jobRef.current = next;
      setJob(next);
      onStatusChange?.(next);

      if (shouldTriggerDownload(previous, next) && next.downloadUrl) {
        download(next.downloadUrl, next.downloadFilename ?? "doublage.mp4");
      }

      if (next.status === "pret") {
        setUiState("done");
      } else if (next.status === "echec") {
        setUiState("error");
        setMessage(next.error ?? "La génération du doublage a échoué.");
      }
    },
    [download, onStatusChange]
  );

  const poll = useCallback(
    async (id: string) => {
      if (cancelledRef.current || !doFetch) return;
      try {
        const res = await doFetch(`/api/doublages/${encodeURIComponent(id)}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Le job de doublage a expiré ou n'existe plus."
              : `Erreur serveur (${res.status}).`
          );
        }
        const data = (await res.json()) as { job: DoublageJobView };
        applyJob(data.job);

        if (!isTerminalDoublageStatus(data.job.status) && !cancelledRef.current) {
          const delay = computeNextPollDelayMs(attemptRef.current);
          attemptRef.current += 1;
          pollHandleRef.current = schedule(() => void poll(id), delay);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setUiState("error");
        setMessage(err instanceof Error ? err.message : "Erreur inattendue pendant le suivi du doublage.");
      }
    },
    [applyJob, doFetch, schedule]
  );

  const startExport = useCallback(async () => {
    if (!recording || !doFetch) return;

    const validationError = validateDoublageRequest({
      extraitId,
      audioMimeType: recording.mimeType || recording.blob.type,
      audioSizeBytes: recording.blob.size,
      audioDurationSeconds: recording.durationSeconds,
    });
    if (validationError) {
      setUiState("error");
      setMessage(validationError);
      return;
    }

    cancelledRef.current = false;
    attemptRef.current = 0;
    clearPendingPoll();
    setMessage(null);
    setShareUrl(null);
    setShareError(null);
    setSauvegardeId(null);
    setSauvegardeError(null);
    setUiState("submitting");

    const form = new FormData();
    form.append("audio", recording.blob, "voix");
    form.append("extraitId", extraitId);
    form.append("audioDurationSeconds", String(recording.durationSeconds));
    form.append("audioOffsetSeconds", String(recording.startedAtVideoTimeSeconds));
    if (mode) form.append("mode", mode);

    try {
      const res = await doFetch("/api/doublages", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { job?: DoublageJobView; error?: string };
      if (!res.ok || !data.job) {
        throw new Error(data.error ?? `La demande d'export a échoué (${res.status}).`);
      }
      setUiState("processing");
      applyJob(data.job);
      if (!isTerminalDoublageStatus(data.job.status)) {
        void poll(data.job.id);
      }
    } catch (err) {
      setUiState("error");
      setMessage(err instanceof Error ? err.message : "La demande d'export a échoué.");
    }
  }, [applyJob, clearPendingPoll, doFetch, extraitId, mode, poll, recording]);

  const publishShare = useCallback(async () => {
    const jobId = jobRef.current?.id;
    if (!jobId || !doFetch) return;
    setSharePending(true);
    setShareError(null);
    try {
      const res = await doFetch(`/api/doublages/${encodeURIComponent(jobId)}/partage`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as { job?: DoublageJobView; error?: string };
      if (!res.ok || !data.job?.shareUrl) {
        throw new Error(data.error ?? `Le partage a échoué (${res.status}).`);
      }
      setShareUrl(data.job.shareUrl);
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Le lien de partage n'a pas pu être généré."
      );
    } finally {
      setSharePending(false);
    }
  }, [doFetch]);

  const publishSauvegarde = useCallback(async () => {
    const jobId = jobRef.current?.id;
    if (!jobId || !doFetch) return;
    setSauvegardePending(true);
    setSauvegardeError(null);
    try {
      const res = await doFetch(`/api/doublages/${encodeURIComponent(jobId)}/sauvegarder`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        sauvegarde?: { id: string };
        error?: string;
      };
      // `200` (déjà sauvegardé) et `201` (créée) sont tous deux un succès —
      // seule l'idempotence côté serveur (`sauvegarderDoublage`) distingue
      // les deux, sans conséquence pour l'affichage.
      if (!res.ok || !data.sauvegarde?.id) {
        throw new Error(data.error ?? `La sauvegarde a échoué (${res.status}).`);
      }
      setSauvegardeId(data.sauvegarde.id);
    } catch (err) {
      setSauvegardeError(
        err instanceof Error ? err.message : "Le doublage n'a pas pu être sauvegardé."
      );
    } finally {
      setSauvegardePending(false);
    }
  }, [doFetch]);

  const canExport = recording !== null && (uiState === "idle" || uiState === "error" || uiState === "done");
  const busy = uiState === "submitting" || uiState === "processing";
  const progressPct = Math.round((job?.progress ?? 0) * 100);

  return (
    <Card
      variant="raised"
      padding="var(--space-5)"
      data-testid="doublage-export"
      style={{ ...PANEL_BODY_STYLE, ...style }}
    >
      {!recording && (
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
          Terminez un enregistrement pour pouvoir générer le fichier de doublage.
        </p>
      )}

      {canExport && recording && (
        <Button type="button" icon="download" onClick={() => void startExport()}>
          {uiState === "done" ? "Régénérer et télécharger" : "Générer et télécharger le doublage"}
        </Button>
      )}

      {busy && (
        <div
          role="status"
          data-testid="doublage-progress"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
        >
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            {uiState === "submitting"
              ? "Envoi de votre enregistrement…"
              : "Génération du fichier de doublage…"}
          </p>
          <ProgressBar
            value={progressPct}
            label="Génération"
            aria-label="Progression de la génération du doublage"
          />
        </div>
      )}

      {uiState === "done" && job?.downloadUrl && (
        <p role="status" style={{ margin: 0, color: "var(--text-secondary)" }}>
          Votre doublage est prêt. Le téléchargement a démarré ; sinon,{" "}
          <a href={job.downloadUrl} download={job.downloadFilename}>
            cliquez ici
          </a>
          .{job.expiresAt ? ` Ce lien expire le ${formatExpiry(job.expiresAt)}.` : ""}
        </p>
      )}

      {uiState === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {!shareUrl ? (
            <Button
              type="button"
              variant="secondary"
              icon="share-2"
              disabled={sharePending}
              onClick={() => void publishShare()}
            >
              {sharePending ? "Génération du lien…" : "Partager ce doublage"}
            </Button>
          ) : (
            <>
              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-caption)" }}>
                Lien public de partage — accessible sans compte. Indépendant de toute sauvegarde
                privée.
              </p>
              <DoublageShareButtons
                shareUrl={shareUrl}
                extraitTitre={extraitTitre || null}
              />
            </>
          )}
          {shareError && (
            <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}>
              {shareError}
            </p>
          )}
        </div>
      )}

      {/* Sauvegarde privée (ST 6.1) : uniquement pour un compte connecté —
          cf. note de dev DoublageExportProps.connecte. */}
      {uiState === "done" && connecte && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {!sauvegardeId ? (
            <Button
              type="button"
              variant="secondary"
              icon="bookmark"
              disabled={sauvegardePending}
              onClick={() => void publishSauvegarde()}
            >
              {sauvegardePending ? "Sauvegarde…" : "Sauvegarder dans mon espace"}
            </Button>
          ) : (
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-caption)" }}>
              Doublage sauvegardé en privé.{" "}
              <a href={MON_ESPACE_HISTORIQUE_PATH}>Voir mon espace</a>.
            </p>
          )}
          {sauvegardeError && (
            <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}>
              {sauvegardeError}
            </p>
          )}
        </div>
      )}

      {uiState === "error" && (
        <p role="alert" style={{ margin: 0, color: "var(--state-danger)" }}>
          {message}
        </p>
      )}
    </Card>
  );
}

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("fr-FR");
}

export default DoublageExport;
