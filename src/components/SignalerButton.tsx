"use client";

import {
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/Button";
import {
  composeMotif,
  MOTIFS_SIGNALEMENT,
  SIGNALEMENT_MOTIF_MAX_LENGTH,
  SIGNALEMENTS_API_PATH,
  type TypeContenuSignale,
} from "@/lib/signalementClient";

/**
 * Bouton et formulaire de signalement d'un contenu — ST 7.1 « Signalement de
 * contenu », découpage en tâches point 3 : « Bouton/action « signaler » sur les
 * composants de lecture (extrait et doublage) ».
 *
 * Repliable : un bouton discret « Signaler » déplie un petit formulaire
 * (catégorie de motif obligatoire + précisions optionnelles). À la soumission,
 * `POST /api/signalements` — endpoint **ouvert aux visiteurs non connectés**
 * (cf. cahier des charges §3-4). En cas de succès, le formulaire est remplacé
 * par un accusé de réception ; le contenu n'est pas masqué (le tri relève de la
 * modération, ST 7.2).
 *
 * Point d'injection pour les tests (même convention que `RegisterForm` /
 * `DoublageShareButtons`) : `fetchImpl`.
 */
export interface SignalerButtonProps {
  /** Type du contenu signalé. */
  contenuType: TypeContenuSignale;
  /** Identifiant du contenu signalé (id d'extrait, ou id de job de doublage). */
  contenuId: string;
  /** Titre affiché à titre de rappel dans le formulaire (facultatif). */
  contenuTitre?: string | null;
  style?: CSSProperties;
  /** `fetch` injectable — défaut : `window.fetch`. */
  fetchImpl?: typeof fetch;
}

type Etat = "ferme" | "ouvert" | "envoi" | "envoye";

const PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-4)",
  marginTop: "var(--space-2)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-hard-sm)",
  maxWidth: 420,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: "var(--text-caption)",
  fontWeight: "var(--weight-semibold)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-caps)",
  color: "var(--text-secondary)",
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

export function SignalerButton({
  contenuType,
  contenuId,
  contenuTitre,
  style,
  fetchImpl,
}: SignalerButtonProps) {
  const [etat, setEtat] = useState<Etat>("ferme");
  const [motifId, setMotifId] = useState<string>("");
  const [details, setDetails] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const motifSelectId = useId();
  const detailsId = useId();

  const doFetch = useMemo(
    () => fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined),
    [fetchImpl]
  );

  const reset = useCallback(() => {
    setMotifId("");
    setDetails("");
    setErreur(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setErreur(null);

    const motif = composeMotif(motifId, details);
    if (!motif) {
      setErreur("Merci de choisir un motif de signalement.");
      return;
    }
    if (!doFetch) {
      setErreur("Le signalement est indisponible pour le moment.");
      return;
    }

    setEtat("envoi");
    try {
      const res = await doFetch(SIGNALEMENTS_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenuType, contenuId, motif }),
      });

      if (res.ok) {
        reset();
        setEtat("envoye");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 429) {
        setErreur(
          data.error ?? "Trop de signalements envoyés. Réessayez dans quelques minutes."
        );
      } else {
        setErreur(data.error ?? "Le signalement n'a pas pu être envoyé.");
      }
      setEtat("ouvert");
    } catch {
      setErreur("Le signalement n'a pas pu être envoyé. Vérifiez votre connexion.");
      setEtat("ouvert");
    }
  }, [motifId, details, doFetch, contenuType, contenuId, reset]);

  if (etat === "envoye") {
    return (
      <p
        role="status"
        style={{
          margin: 0,
          fontSize: "var(--text-caption)",
          color: "var(--text-secondary)",
          ...style,
        }}
      >
        Merci, votre signalement a été transmis à l&apos;équipe de modération.
      </p>
    );
  }

  if (etat === "ferme") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon="flag"
        aria-expanded={false}
        onClick={() => setEtat("ouvert")}
        style={style}
      >
        Signaler
      </Button>
    );
  }

  const enEnvoi = etat === "envoi";

  return (
    <div style={style}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon="flag"
        aria-expanded
        onClick={() => {
          reset();
          setEtat("ferme");
        }}
      >
        Signaler
      </Button>

      <div style={PANEL_STYLE} data-testid="signaler-panel">
        {contenuTitre ? (
          <p style={{ margin: 0, fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
            Contenu signalé : <strong>{contenuTitre}</strong>
          </p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label htmlFor={motifSelectId} style={LABEL_STYLE}>
            Motif
          </label>
          <select
            id={motifSelectId}
            value={motifId}
            disabled={enEnvoi}
            onChange={(e) => setMotifId(e.target.value)}
            style={FIELD_STYLE}
          >
            <option value="">— Choisir un motif —</option>
            {MOTIFS_SIGNALEMENT.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label htmlFor={detailsId} style={LABEL_STYLE}>
            Précisions (facultatif)
          </label>
          <textarea
            id={detailsId}
            value={details}
            disabled={enEnvoi}
            maxLength={SIGNALEMENT_MOTIF_MAX_LENGTH}
            rows={3}
            onChange={(e) => setDetails(e.target.value)}
            style={{ ...FIELD_STYLE, resize: "vertical" }}
          />
        </div>

        {erreur ? (
          <p
            role="alert"
            style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-caption)" }}
          >
            {erreur}
          </p>
        ) : null}

        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={enEnvoi}
          onClick={() => void handleSubmit()}
        >
          {enEnvoi ? "Envoi…" : "Envoyer le signalement"}
        </Button>
      </div>
    </div>
  );
}

export default SignalerButton;
