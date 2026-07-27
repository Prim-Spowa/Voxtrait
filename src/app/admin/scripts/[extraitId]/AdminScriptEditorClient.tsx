"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { validateScriptLigneInput, type ScriptLigneInput } from "@/lib/scriptClient";
import type { ScriptLigneDTO, ScriptResponse } from "@/types/script";

/**
 * Outil interne de saisie/import des lignes de script (ST 1.3
 * "Synchronisation script/dialogue", découpage en tâches, point 4).
 *
 * Deux modes complémentaires, alimentant le même lot en attente :
 * - saisie ligne à ligne (formulaire) — cas d'usage principal visé par la
 *   story ("outil interne [...] de saisie") ;
 * - import en masse (coller un tableau JSON de lignes) — cas d'usage
 *   "import" de la même tâche, pour transcrire un script entier sans repasser
 *   par le formulaire ligne à ligne.
 *
 * Le lot en attente est envoyé en un seul appel à `POST
 * /api/extraits/:id/script` (import atomique côté serveur, cf.
 * `lib/script.ts#parseScriptLignesPayload`) : soit toutes les lignes sont
 * insérées, soit aucune (erreur affichée, rien n'est perdu côté client — le
 * lot en attente n'est vidé qu'après un succès confirmé par le serveur).
 *
 * ⚠️ **Aucun contrôle d'accès.** Aucun système d'authentification/rôles
 * n'existe encore dans le projet (ST 4.x, non développé à ce stade) — cf.
 * avertissement identique dans `route.ts`. Le bandeau ci-dessous rend ce
 * point visible à quiconque ouvre la page, en attendant une story dédiée à
 * la protection de cet outil.
 */
export interface AdminScriptEditorClientProps {
  extraitId: string;
}

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  padding: "var(--space-5)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  borderRadius: "var(--radius-card)",
};

const TEXTAREA_STYLE: CSSProperties = {
  width: "100%",
  minHeight: 140,
  padding: "var(--space-3)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-body-sm)",
  border: "2px solid var(--border-medium)",
  borderRadius: "var(--radius-control)",
  resize: "vertical",
};

/** Représentation JSON attendue pour une ligne, dans le textarea d'import en masse. */
const EXEMPLE_IMPORT = JSON.stringify(
  [{ texte: "Tu ne passeras pas ce pont.", timestampDebut: 0, timestampFin: 3.2 }],
  null,
  2
);

export function AdminScriptEditorClient({ extraitId }: AdminScriptEditorClientProps) {
  const [existing, setExisting] = useState<ScriptLigneDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [texte, setTexte] = useState("");
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [pending, setPending] = useState<ScriptLigneInput[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const [bulkJson, setBulkJson] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "success" | "error">(
    "idle"
  );
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadExisting() {
      try {
        const res = await fetch(`/api/extraits/${encodeURIComponent(extraitId)}/script`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        const json: ScriptResponse = await res.json();
        setExisting(json.lignes);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Erreur inconnue");
      }
    }

    loadExisting();
    return () => controller.abort();
  }, [extraitId]);

  function addLine() {
    const candidate: ScriptLigneInput = {
      texte,
      timestampDebut: Number(debut),
      timestampFin: Number(fin),
    };
    const error = validateScriptLigneInput(candidate);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setPending((prev) => [...prev, candidate]);
    setTexte("");
    setDebut("");
    setFin("");
  }

  function removePending(index: number) {
    setPending((prev) => prev.filter((_, i) => i !== index));
  }

  function addBulk() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bulkJson);
    } catch {
      setBulkError("JSON invalide.");
      return;
    }
    if (!Array.isArray(parsed)) {
      setBulkError("Le JSON doit être un tableau de lignes.");
      return;
    }

    const candidates: ScriptLigneInput[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i] as Record<string, unknown> | null;
      const candidate: ScriptLigneInput = {
        texte: typeof entry?.texte === "string" ? entry.texte : "",
        timestampDebut: Number(entry?.timestampDebut),
        timestampFin: Number(entry?.timestampFin),
      };
      const error = validateScriptLigneInput(candidate);
      if (error) {
        setBulkError(`Ligne ${i + 1} du JSON collé : ${error}`);
        return;
      }
      candidates.push(candidate);
    }

    setBulkError(null);
    setPending((prev) => [...prev, ...candidates]);
    setBulkJson("");
  }

  async function submitPending() {
    if (pending.length === 0) return;
    setSubmitState("submitting");
    setSubmitMessage(null);
    try {
      const res = await fetch(`/api/extraits/${encodeURIComponent(extraitId)}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lignes: pending }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Erreur ${res.status}`);
      }
      setSubmitState("success");
      setSubmitMessage(`${body.inserted} ligne(s) importée(s) avec succès.`);
      setExisting((prev) => [
        ...(prev ?? []),
        ...pending.map((ligne, i) => ({ ...ligne, id: `en-attente-de-rafraichissement-${i}` })),
      ]);
      setPending([]);
    } catch (err) {
      setSubmitState("error");
      setSubmitMessage(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "var(--space-6) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0, fontSize: "var(--text-title)" }}>
          Script — {extraitId} <span style={{ color: "var(--text-muted)" }}>(ST 1.3)</span>
        </h1>
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "var(--space-3)",
            background: "var(--state-warning)",
            color: "var(--text-on-accent)",
            borderRadius: "var(--radius-control)",
            fontSize: "var(--text-body-sm)",
          }}
        >
          ⚠ Outil interne sans contrôle d&apos;accès : n&apos;importe qui connaissant cette URL peut
          modifier le script. À protéger avant mise en production (cf. ST 4.x, comptes et rôles —
          non développé à ce stade).
        </p>
      </header>

      <section style={CARD_STYLE} aria-labelledby="script-existant">
        <h2 id="script-existant" style={{ margin: 0, fontSize: "var(--text-subtitle)" }}>
          Script existant
        </h2>
        {loadError ? (
          <p role="alert" style={{ margin: 0, color: "var(--state-danger)" }}>
            Impossible de charger le script existant ({loadError}).
          </p>
        ) : existing === null ? (
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>Chargement…</p>
        ) : existing.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            Aucune ligne pour cet extrait pour le moment.
          </p>
        ) : (
          <ol
            data-testid="script-existant-liste"
            style={{ margin: 0, padding: "0 0 0 var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
          >
            {existing.map((ligne) => (
              <li key={ligne.id} style={{ fontSize: "var(--text-body-sm)" }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                  {ligne.timestampDebut.toFixed(1)}s–{ligne.timestampFin.toFixed(1)}s
                </span>{" "}
                {ligne.texte}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section style={CARD_STYLE} aria-labelledby="saisie-ligne">
        <h2 id="saisie-ligne" style={{ margin: 0, fontSize: "var(--text-subtitle)" }}>
          Ajouter une ligne
        </h2>
        <Input id="texte-ligne" label="Texte de la réplique" value={texte} onChange={(e) => setTexte(e.target.value)} />
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <Input
            id="debut-ligne"
            label="Début (s)"
            type="text"
            value={debut}
            onChange={(e) => setDebut(e.target.value)}
            mono
          />
          <Input
            id="fin-ligne"
            label="Fin (s)"
            type="text"
            value={fin}
            onChange={(e) => setFin(e.target.value)}
            mono
          />
        </div>
        {formError ? (
          <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-body-sm)" }}>
            {formError}
          </p>
        ) : null}
        <Button type="button" variant="secondary" onClick={addLine}>
          Ajouter à la liste d&apos;attente
        </Button>
      </section>

      <section style={CARD_STYLE} aria-labelledby="import-masse">
        <h2 id="import-masse" style={{ margin: 0, fontSize: "var(--text-subtitle)" }}>
          Importer en masse (JSON)
        </h2>
        <p style={{ margin: 0, fontSize: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
          Coller un tableau JSON, ex. <code>{EXEMPLE_IMPORT}</code>
        </p>
        <label htmlFor="bulk-json" style={{ fontSize: "var(--text-caption)", fontWeight: "var(--weight-semibold)" }}>
          Lignes au format JSON
        </label>
        <textarea
          id="bulk-json"
          value={bulkJson}
          onChange={(e) => setBulkJson(e.target.value)}
          style={TEXTAREA_STYLE}
        />
        {bulkError ? (
          <p role="alert" style={{ margin: 0, color: "var(--state-danger)", fontSize: "var(--text-body-sm)" }}>
            {bulkError}
          </p>
        ) : null}
        <Button type="button" variant="secondary" onClick={addBulk}>
          Ajouter le lot à la liste d&apos;attente
        </Button>
      </section>

      <section style={CARD_STYLE} aria-labelledby="liste-attente">
        <h2 id="liste-attente" style={{ margin: 0, fontSize: "var(--text-subtitle)" }}>
          En attente d&apos;envoi ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>Rien en attente pour l&apos;instant.</p>
        ) : (
          <ol
            data-testid="liste-attente"
            style={{ margin: 0, padding: "0 0 0 var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
          >
            {pending.map((ligne, i) => (
              <li key={i} style={{ fontSize: "var(--text-body-sm)", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                  {ligne.timestampDebut.toFixed(1)}s–{ligne.timestampFin.toFixed(1)}s
                </span>
                {ligne.texte}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Retirer la ligne "${ligne.texte}" de la liste d'attente`}
                  onClick={() => removePending(i)}
                >
                  Retirer
                </Button>
              </li>
            ))}
          </ol>
        )}
        <Button type="button" variant="primary" disabled={pending.length === 0 || submitState === "submitting"} onClick={submitPending}>
          {submitState === "submitting" ? "Envoi…" : `Envoyer ${pending.length} ligne(s)`}
        </Button>
        {submitMessage ? (
          <p
            role={submitState === "error" ? "alert" : "status"}
            style={{
              margin: 0,
              color: submitState === "error" ? "var(--state-danger)" : "var(--state-success)",
              fontSize: "var(--text-body-sm)",
            }}
          >
            {submitMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}

export default AdminScriptEditorClient;
