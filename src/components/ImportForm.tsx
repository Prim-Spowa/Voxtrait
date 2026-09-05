"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/Button";
import {
  CERTIFICATION_DROITS_CASE_LABEL,
  CERTIFICATION_DROITS_TEXTE,
} from "@/lib/certificationDroits";
import {
  ACCEPTED_IMPORT_EXTENSIONS,
  ACCEPTED_IMPORT_MIME_TYPES,
  IMPORT_TITRE_MAX_LENGTH,
  MAX_IMPORT_DURATION_SECONDS,
  MAX_IMPORT_FILE_BYTES,
  ORIGINES_IMPORT,
  TYPES_IMPORT,
  collectImportFormErrors,
  computeNextImportPollDelayMs,
  isTerminalImportStatus,
  suggestTitreFromFilename,
  validateImportUploadRequest,
  type ImportFormErrors,
  type ImportJobView,
} from "@/lib/importClient";
import { ORIGINE_LABELS, TYPE_LABELS } from "@/types/extrait";

/**
 * Formulaire d'import d'un extrait vidéo personnel — ST 9.5 « Formulaire
 * d'import utilisateur (page `/import`) » (US 5.1 : importer un extrait vidéo
 * personnel).
 *
 * Déroule côté utilisateur le parcours déjà exposé côté API par ST 5.1/ST 5.2 :
 *
 *  1. sélection du fichier + métadonnées de classification (titre, origine,
 *     type) et certification des droits obligatoire (ST 5.2) ;
 *  2. `POST /api/import/upload-url` — demande d'une URL d'upload signée ;
 *  3. upload direct du fichier vers cette URL (`PUT`, hors du serveur
 *     applicatif — cf. ST 9.2) ;
 *  4. `POST /api/import` — validation post-upload + lancement de la
 *     compression (`objectRef` renvoyé à l'étape précédente) ;
 *  5. suivi par polling de `GET /api/import/:id` (back-off, cf.
 *     `computeNextImportPollDelayMs`) jusqu'à un statut terminal
 *     (`pret` → extrait créé en attente de modération, ou `echec`).
 *
 * Toute la validation de forme (formats/taille/durée, champs de
 * classification, certification) réutilise les fonctions pures de
 * `lib/importClient.ts` — même source de vérité que les Route Handlers
 * (`resolveImportAccess`, `collectImportFormErrors`, `finalizeImport`) : un
 * rejet serveur ne peut arriver ici que sur un cas que le client ne peut pas
 * vérifier lui-même (session expirée entre-temps, durée réelle de la vidéo
 * mesurée après upload, etc).
 *
 * Points d'injection pour les tests (mêmes conventions que `DoublageExport` /
 * `VoiceRecorder`) : `fetchImpl`, `schedulePoll`, `cancelPoll`.
 */
export interface ImportFormProps {
  style?: CSSProperties;
  /** `fetch` injectable pour les tests. */
  fetchImpl?: typeof fetch;
  /** Planificateur du prochain poll — défaut `setTimeout`. Injecté pour contrôler le temps en test. */
  schedulePoll?: (callback: () => void, delayMs: number) => number;
  /** Annulation d'un poll planifié — défaut `clearTimeout`. */
  cancelPoll?: (handle: number) => void;
}

type UiState = "selection" | "upload" | "traitement" | "pret" | "echec";

const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  borderRadius: "var(--radius-card)",
  maxWidth: 560,
};

const FIELD_STYLE: CSSProperties = {
  width: "100%",
  padding: "9px var(--space-3)",
  background: "var(--surface-card)",
  border: "2px solid var(--border-medium)",
  borderRadius: "var(--radius-control)",
  fontSize: "var(--text-body)",
  fontFamily: "var(--font-ui)",
};

const LABEL_STYLE: CSSProperties = {
  fontSize: "var(--text-caption)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text-secondary)",
};

const CHAMP_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

/** Formate un nombre d'octets en Mo entiers, pour l'aide au format de fichier. */
function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} Mo`;
}

export function ImportForm({ style, fetchImpl, schedulePoll, cancelPoll }: ImportFormProps) {
  const [etat, setEtat] = useState<UiState>("selection");
  const [file, setFile] = useState<File | null>(null);
  const [titre, setTitre] = useState("");
  const [origine, setOrigine] = useState<(typeof ORIGINES_IMPORT)[number]>("FR");
  const [type, setType] = useState<(typeof TYPES_IMPORT)[number]>("FILM");
  const [certifieDroits, setCertifieDroits] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ImportFormErrors>({});
  const [job, setJob] = useState<ImportJobView | null>(null);

  const jobRef = useRef<ImportJobView | null>(null);
  const pollHandleRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);

  const ids = {
    fichier: useId(),
    titre: useId(),
    origine: useId(),
    type: useId(),
    certification: useId(),
  };

  const doFetch = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const schedule =
    schedulePoll ??
    ((cb: () => void, ms: number) => setTimeout(cb, ms) as unknown as number);
  const cancel = cancelPoll ?? ((h: number) => clearTimeout(h));

  // Même précaution que `DoublageExport` : `cancel` peut changer d'identité à
  // chaque rendu (fabrique par défaut) — on garde sa dernière version dans une
  // ref pour que l'effet de démontage reste à dépendances vides.
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  const clearPendingPoll = useCallback(() => {
    if (pollHandleRef.current !== null) {
      cancelRef.current(pollHandleRef.current);
      pollHandleRef.current = null;
    }
  }, []);

  // Nettoyage au démontage uniquement : ne pas laisser un poll planifié
  // rappeler `setState` sur un composant démonté (même précaution que
  // `DoublageExport` / `VoiceRecorder`).
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearPendingPoll();
    };
  }, [clearPendingPoll]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setErreur(null);
    if (selected && !titre.trim()) {
      setTitre(suggestTitreFromFilename(selected.name));
    }
  }

  const poll = useCallback(
    async (id: string) => {
      if (cancelledRef.current || !doFetch) return;
      try {
        const res = await doFetch(`/api/import/${encodeURIComponent(id)}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Le suivi de l'import a expiré ou n'existe plus."
              : `Erreur serveur (${res.status}).`
          );
        }
        const data = (await res.json()) as { job: ImportJobView };
        jobRef.current = data.job;
        setJob(data.job);

        if (isTerminalImportStatus(data.job.status)) {
          setEtat(data.job.status === "pret" ? "pret" : "echec");
          if (data.job.status === "echec") {
            setErreur(data.job.error ?? "Le traitement de la vidéo a échoué.");
          }
        } else if (!cancelledRef.current) {
          const delay = computeNextImportPollDelayMs(attemptRef.current);
          attemptRef.current += 1;
          pollHandleRef.current = schedule(() => void poll(id), delay);
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setEtat("echec");
        setErreur(
          err instanceof Error ? err.message : "Erreur inattendue pendant le suivi de l'import."
        );
      }
    },
    [doFetch, schedule]
  );

  const handleSubmit = useCallback(async () => {
    setErreur(null);
    setFieldErrors({});

    if (!file) {
      setErreur("Choisissez un fichier vidéo à importer.");
      return;
    }

    const errors = collectImportFormErrors({ titre, origine, type, certifieDroits });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setErreur("Corrigez les champs indiqués avant de continuer.");
      return;
    }

    const uploadRequestError = validateImportUploadRequest({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (uploadRequestError) {
      setErreur(uploadRequestError);
      return;
    }

    if (!doFetch) {
      setErreur("L'import est indisponible pour le moment.");
      return;
    }

    cancelledRef.current = false;
    attemptRef.current = 0;
    clearPendingPoll();
    setJob(null);
    setEtat("upload");

    try {
      // 1. Demande d'URL d'upload signée.
      const urlRes = await doFetch("/api/import/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });
      const urlData = (await urlRes.json().catch(() => ({}))) as {
        upload?: {
          uploadUrl: string;
          method: "PUT" | "POST";
          headers: Record<string, string>;
          objectRef: string;
        };
        error?: string;
      };
      if (!urlRes.ok || !urlData.upload) {
        throw new Error(urlData.error ?? `La préparation de l'import a échoué (${urlRes.status}).`);
      }
      const { uploadUrl, method, headers, objectRef } = urlData.upload;

      // 2. Upload direct du fichier vers l'URL signée.
      const uploadRes = await doFetch(uploadUrl, { method, headers, body: file });
      if (!uploadRes.ok) {
        throw new Error(`L'envoi du fichier a échoué (${uploadRes.status}).`);
      }

      // 3. Finalisation : validation post-upload + lancement de la compression.
      setEtat("traitement");
      const importRes = await doFetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectRef, titre, origine, type, certifieDroits }),
      });
      const importData = (await importRes.json().catch(() => ({}))) as {
        job?: ImportJobView;
        error?: string;
        fieldErrors?: ImportFormErrors;
      };
      if (!importRes.ok || !importData.job) {
        if (importData.fieldErrors) setFieldErrors(importData.fieldErrors);
        throw new Error(importData.error ?? `L'import a échoué (${importRes.status}).`);
      }

      jobRef.current = importData.job;
      setJob(importData.job);
      if (isTerminalImportStatus(importData.job.status)) {
        setEtat(importData.job.status === "pret" ? "pret" : "echec");
        if (importData.job.status === "echec") {
          setErreur(importData.job.error ?? "Le traitement de la vidéo a échoué.");
        }
      } else {
        void poll(importData.job.id);
      }
    } catch (err) {
      setEtat("echec");
      setErreur(err instanceof Error ? err.message : "L'import a échoué. Réessayez plus tard.");
    }
  }, [certifieDroits, clearPendingPoll, doFetch, file, origine, poll, titre, type]);

  function reinitialiser() {
    cancelledRef.current = true;
    clearPendingPoll();
    setEtat("selection");
    setFile(null);
    setTitre("");
    setOrigine("FR");
    setType("FILM");
    setCertifieDroits(false);
    setErreur(null);
    setFieldErrors({});
    setJob(null);
  }

  const busy = etat === "upload" || etat === "traitement";
  const progressPct = Math.round((job?.progress ?? 0) * 100);

  if (etat === "pret") {
    return (
      <div style={{ ...PANEL_STYLE, ...style }} data-testid="import-form">
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <p style={{ margin: 0 }}>
            Votre vidéo a bien été importée et compressée. Elle est désormais en
            attente de modération avant d&apos;apparaître dans la bibliothèque.
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <Button type="button" variant="secondary" size="md" onClick={reinitialiser}>
            Importer une autre vidéo
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => window.location.assign("/bibliotheque")}
          >
            Retour à la bibliothèque
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      style={{ ...PANEL_STYLE, ...style }}
      data-testid="import-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.fichier} style={LABEL_STYLE}>
          Fichier vidéo
        </label>
        <input
          id={ids.fichier}
          type="file"
          accept={[...ACCEPTED_IMPORT_MIME_TYPES, ...ACCEPTED_IMPORT_EXTENSIONS].join(",")}
          disabled={busy}
          onChange={handleFileChange}
          style={FIELD_STYLE}
        />
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
          Formats acceptés : MP4, MOV, WebM, MKV — durée maximale{" "}
          {Math.round(MAX_IMPORT_DURATION_SECONDS / 60)} minutes, taille maximale{" "}
          {formatMegabytes(MAX_IMPORT_FILE_BYTES)}.
        </p>
        {file && (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-caption)" }}>
            Fichier sélectionné : {file.name} ({formatMegabytes(file.size)})
          </p>
        )}
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.titre} style={LABEL_STYLE}>
          Titre
        </label>
        <input
          id={ids.titre}
          value={titre}
          disabled={busy}
          maxLength={IMPORT_TITRE_MAX_LENGTH}
          onChange={(e) => setTitre(e.target.value)}
          style={FIELD_STYLE}
        />
        {fieldErrors.titre && (
          <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}>
            {fieldErrors.titre}
          </p>
        )}
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.origine} style={LABEL_STYLE}>
          Origine
        </label>
        <select
          id={ids.origine}
          value={origine}
          disabled={busy}
          onChange={(e) => setOrigine(e.target.value as (typeof ORIGINES_IMPORT)[number])}
          style={FIELD_STYLE}
        >
          {ORIGINES_IMPORT.map((o) => (
            <option key={o} value={o}>
              {ORIGINE_LABELS[o]}
            </option>
          ))}
        </select>
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.type} style={LABEL_STYLE}>
          Type
        </label>
        <select
          id={ids.type}
          value={type}
          disabled={busy}
          onChange={(e) => setType(e.target.value as (typeof TYPES_IMPORT)[number])}
          style={FIELD_STYLE}
        >
          {TYPES_IMPORT.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
        <input
          id={ids.certification}
          type="checkbox"
          checked={certifieDroits}
          disabled={busy}
          onChange={(e) => setCertifieDroits(e.target.checked)}
        />
        <span style={{ fontSize: "var(--text-caption)" }}>
          <strong>{CERTIFICATION_DROITS_CASE_LABEL}</strong>
          <br />
          {CERTIFICATION_DROITS_TEXTE}
        </span>
      </label>
      {fieldErrors.certifieDroits && (
        <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}>
          {fieldErrors.certifieDroits}
        </p>
      )}

      {busy && (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            {etat === "upload"
              ? "Envoi du fichier vers le stockage…"
              : `Traitement de la vidéo (compression)… ${progressPct}%`}
          </p>
          <progress
            value={etat === "traitement" ? progressPct : undefined}
            max={100}
            data-testid="import-progress"
            style={{ width: "100%" }}
          />
        </div>
      )}

      {erreur && !busy && (
        <p role="alert" style={{ margin: 0, color: "var(--state-danger)" }}>
          {erreur}
        </p>
      )}

      <Button type="submit" variant="primary" size="md" icon="upload" disabled={busy}>
        {busy ? "Import en cours…" : "Importer cette vidéo"}
      </Button>
    </form>
  );
}

export default ImportForm;
