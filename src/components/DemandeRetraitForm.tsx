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
  DEMANDES_RETRAIT_API_PATH,
  DEMANDE_RETRAIT_MOTIF_MAX_LENGTH,
  OEUVRE_MAX_LENGTH,
  TYPES_CONTENU_SIGNALE,
  type TypeContenuSignale,
} from "@/lib/demandeRetraitClient";

/**
 * Formulaire public de demande de retrait — ST 7.3 « Procédure
 * notice-and-takedown », découpage en tâches point 2 : « Formulaire/point de
 * contact « demande de retrait » ».
 *
 * Destiné aux **ayants droit** (hors du parcours utilisateur habituel) : il
 * réclame une identité, un email de contact vérifiable, l'œuvre invoquée, un
 * exposé, et une **déclaration de bonne foi obligatoire**. À la soumission,
 * `POST /api/demandes-retrait` (ouvert sans compte, rate-limité). En cas de
 * succès, le formulaire est remplacé par un accusé de réception portant
 * l'identifiant de la demande.
 *
 * `fetchImpl` : point d'injection pour les tests (même convention que
 * `SignalerButton`, ST 7.1).
 */
export interface DemandeRetraitFormProps {
  /** Pré-remplissage éventuel (lien depuis une page de contenu). */
  contenuTypeInitial?: TypeContenuSignale;
  contenuIdInitial?: string;
  fetchImpl?: typeof fetch;
}

type Etat = "saisie" | "envoi" | "envoye";

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

export function DemandeRetraitForm({
  contenuTypeInitial = "EXTRAIT",
  contenuIdInitial = "",
  fetchImpl,
}: DemandeRetraitFormProps) {
  const [etat, setEtat] = useState<Etat>("saisie");
  const [contenuType, setContenuType] = useState<TypeContenuSignale>(contenuTypeInitial);
  const [contenuId, setContenuId] = useState(contenuIdInitial);
  const [oeuvre, setOeuvre] = useState("");
  const [demandeurNom, setDemandeurNom] = useState("");
  const [demandeurEmail, setDemandeurEmail] = useState("");
  const [demandeurOrganisation, setDemandeurOrganisation] = useState("");
  const [motif, setMotif] = useState("");
  const [declaration, setDeclaration] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const ids = {
    type: useId(),
    contenu: useId(),
    oeuvre: useId(),
    nom: useId(),
    email: useId(),
    orga: useId(),
    motif: useId(),
    declaration: useId(),
  };

  const doFetch = useMemo(
    () => fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined),
    [fetchImpl]
  );

  const handleSubmit = useCallback(async () => {
    setErreur(null);

    if (!contenuId.trim()) return setErreur("Indiquez l'identifiant du contenu visé.");
    if (!oeuvre.trim()) return setErreur("Indiquez l'œuvre concernée.");
    if (!demandeurNom.trim()) return setErreur("Indiquez votre nom.");
    if (!demandeurEmail.trim()) return setErreur("Indiquez un email de contact.");
    if (!motif.trim()) return setErreur("Exposez votre demande.");
    if (!declaration) {
      return setErreur(
        "Vous devez déclarer de bonne foi être titulaire des droits ou mandaté."
      );
    }
    if (!doFetch) return setErreur("La demande est indisponible pour le moment.");

    setEtat("envoi");
    try {
      const res = await doFetch(DEMANDES_RETRAIT_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contenuType,
          contenuId: contenuId.trim(),
          oeuvre: oeuvre.trim(),
          demandeurNom: demandeurNom.trim(),
          demandeurEmail: demandeurEmail.trim(),
          demandeurOrganisation: demandeurOrganisation.trim() || undefined,
          motif: motif.trim(),
          declarationBonneFoi: true,
        }),
      });

      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          demande?: { id?: string };
        };
        setReference(data.demande?.id ?? null);
        setEtat("envoye");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErreur(data.error ?? "La demande n'a pas pu être envoyée.");
      setEtat("saisie");
    } catch {
      setErreur("La demande n'a pas pu être envoyée. Vérifiez votre connexion.");
      setEtat("saisie");
    }
  }, [
    contenuType,
    contenuId,
    oeuvre,
    demandeurNom,
    demandeurEmail,
    demandeurOrganisation,
    motif,
    declaration,
    doFetch,
  ]);

  if (etat === "envoye") {
    return (
      <div role="status" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <p style={{ margin: 0 }}>
          Votre demande a bien été reçue. Notre équipe la traite dans les meilleurs
          délais et vous répondra à l&apos;adresse indiquée.
        </p>
        {reference ? (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
            Référence de votre demande : <strong>{reference}</strong>
          </p>
        ) : null}
      </div>
    );
  }

  const enEnvoi = etat === "envoi";

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 560 }}
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.type} style={LABEL_STYLE}>
          Type de contenu
        </label>
        <select
          id={ids.type}
          value={contenuType}
          disabled={enEnvoi}
          onChange={(e) => setContenuType(e.target.value as TypeContenuSignale)}
          style={FIELD_STYLE}
        >
          {TYPES_CONTENU_SIGNALE.map((t) => (
            <option key={t} value={t}>
              {t === "EXTRAIT" ? "Extrait vidéo" : "Doublage"}
            </option>
          ))}
        </select>
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.contenu} style={LABEL_STYLE}>
          Identifiant / URL du contenu visé
        </label>
        <input
          id={ids.contenu}
          value={contenuId}
          disabled={enEnvoi}
          onChange={(e) => setContenuId(e.target.value)}
          style={FIELD_STYLE}
        />
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.oeuvre} style={LABEL_STYLE}>
          Œuvre concernée (titre du film, de la série…)
        </label>
        <input
          id={ids.oeuvre}
          value={oeuvre}
          disabled={enEnvoi}
          maxLength={OEUVRE_MAX_LENGTH}
          onChange={(e) => setOeuvre(e.target.value)}
          style={FIELD_STYLE}
        />
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.nom} style={LABEL_STYLE}>
          Votre nom
        </label>
        <input
          id={ids.nom}
          value={demandeurNom}
          disabled={enEnvoi}
          onChange={(e) => setDemandeurNom(e.target.value)}
          style={FIELD_STYLE}
        />
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.email} style={LABEL_STYLE}>
          Email de contact
        </label>
        <input
          id={ids.email}
          type="email"
          value={demandeurEmail}
          disabled={enEnvoi}
          onChange={(e) => setDemandeurEmail(e.target.value)}
          style={FIELD_STYLE}
        />
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.orga} style={LABEL_STYLE}>
          Organisation représentée (facultatif)
        </label>
        <input
          id={ids.orga}
          value={demandeurOrganisation}
          disabled={enEnvoi}
          onChange={(e) => setDemandeurOrganisation(e.target.value)}
          style={FIELD_STYLE}
        />
      </div>

      <div style={CHAMP_STYLE}>
        <label htmlFor={ids.motif} style={LABEL_STYLE}>
          Exposé de la demande (nature des droits, contenu visé)
        </label>
        <textarea
          id={ids.motif}
          value={motif}
          disabled={enEnvoi}
          rows={5}
          maxLength={DEMANDE_RETRAIT_MOTIF_MAX_LENGTH}
          onChange={(e) => setMotif(e.target.value)}
          style={{ ...FIELD_STYLE, resize: "vertical" }}
        />
      </div>

      <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
        <input
          id={ids.declaration}
          type="checkbox"
          checked={declaration}
          disabled={enEnvoi}
          onChange={(e) => setDeclaration(e.target.checked)}
        />
        <span style={{ fontSize: "var(--text-caption)" }}>
          Je déclare de bonne foi être titulaire des droits sur l&apos;œuvre
          concernée, ou être mandaté pour agir en son nom, et que les informations
          fournies sont exactes.
        </span>
      </label>

      {erreur ? (
        <p role="alert" style={{ margin: 0, color: "var(--state-danger)" }}>
          {erreur}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="md" disabled={enEnvoi}>
        {enEnvoi ? "Envoi…" : "Envoyer la demande de retrait"}
      </Button>
    </form>
  );
}

export default DemandeRetraitForm;
