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
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { UploadDropzone } from "@/components/ui/UploadDropzone";
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

/** Colonne centrée de l'écran d'import (`UploadScreen` du design system). */
const FORM_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-5)",
  width: "100%",
};

/** Carte de confirmation (état « prêt »). */
const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  borderRadius: "var(--radius-card)",
};

const CHAMP_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollHandleRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);

  const ids = {
    fichier: useId(),
    titre: useId(),
    origine: useId(),
    type: useId(),
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
      style={{ ...FORM_STYLE, ...style }}
      data-testid="import-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      {/* Zone de dépôt du design system (`UploadScreen`). Le vrai
          `<input type="file">` reste dans le DOM, masqué : il porte
          l'étiquette « Fichier vidéo » et est déclenché par `onPick`. */}
      <label htmlFor={ids.fichier} style={VISUALLY_HIDDEN}>
        Fichier vidéo
      </label>
      <input
        id={ids.fichier}
        ref={fileInputRef}
        type="file"
        accept={[...ACCEPTED_IMPORT_MIME_TYPES, ...ACCEPTED_IMPORT_EXTENSIONS].join(",")}
        disabled={busy}
        onChange={handleFileChange}
        style={VISUALLY_HIDDEN}
      />
      <UploadDropzone
        state={busy ? "uploading" : "empty"}
        filename={file?.name}
        progress={progressPct}
        error={!busy && erreur && !file ? erreur : undefined}
        onPick={() => fileInputRef.current?.click()}
      />

      {file && !busy ? (
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-caption)" }}>
          Fichier sélectionné : {file.name} ({formatMegabytes(file.size)}) — durée maximale{" "}
          {Math.round(MAX_IMPORT_DURATION_SECONDS / 60)} minutes, taille maximale{" "}
          {formatMegabytes(MAX_IMPORT_FILE_BYTES)}.
        </p>
      ) : null}

      {busy ? (
        <p role="status" style={{ margin: 0, color: "var(--text-secondary)" }}>
          {etat === "upload"
            ? "Envoi du fichier vers le stockage…"
            : `Traitement de la vidéo (compression)… ${progressPct}%`}
        </p>
      ) : null}

      <Card
        padding="var(--space-5)"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <div style={CHAMP_STYLE}>
          <Input
            id={ids.titre}
            label="Titre"
            value={titre}
            disabled={busy}
            placeholder="« Tu ne passeras pas »"
            onChange={(e) => setTitre(e.target.value.slice(0, IMPORT_TITRE_MAX_LENGTH))}
          />
          {fieldErrors.titre && (
            <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}>
              {fieldErrors.titre}
            </p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
          <Select
            id={ids.origine}
            label="Origine"
            value={origine}
            disabled={busy}
            onChange={(e) => setOrigine(e.target.value as (typeof ORIGINES_IMPORT)[number])}
            options={ORIGINES_IMPORT.map((o) => ({ value: o, label: ORIGINE_LABELS[o] }))}
          />
          <Select
            id={ids.type}
            label="Type"
            value={type}
            disabled={busy}
            onChange={(e) => setType(e.target.value as (typeof TYPES_IMPORT)[number])}
            options={TYPES_IMPORT.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
          />
        </div>

        {/* ST 11.1 : case de certification portée sur le composant `Checkbox` du
            design system (vraie case native, focus clavier, `aria-describedby`). */}
        <Checkbox
          checked={certifieDroits}
          disabled={busy}
          onChange={setCertifieDroits}
          label={
            <>
              <strong>{CERTIFICATION_DROITS_CASE_LABEL}</strong>
              <br />
              {CERTIFICATION_DROITS_TEXTE}
            </>
          }
        />
        {fieldErrors.certifieDroits && (
          <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}>
            {fieldErrors.certifieDroits}
          </p>
        )}

        {erreur && !busy && (
          <p role="alert" style={{ margin: 0, color: "var(--state-danger)" }}>
            {erreur}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="submit" variant="primary" size="md" icon="upload" disabled={busy}>
            {busy ? "Import en cours…" : "Importer cette vidéo"}
          </Button>
        </div>
      </Card>
    </form>
  );
}

export default ImportForm;
