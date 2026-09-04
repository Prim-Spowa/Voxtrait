"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Button } from "@/components/ui/Button";
import {
  DEMANDES_RETRAIT_ADMIN_API_PATH,
  DEMANDES_RETRAIT_RAPPORT_API_PATH,
  STATUTS_DEMANDE_RETRAIT,
  type ActionDemandeRetrait,
  type DemandeRetraitModereView,
  type FileDemandesRetraitResponse,
  type RapportDelaisTraitement,
  type StatutDemandeRetrait,
} from "@/lib/demandeRetraitClient";

/**
 * Tableau de bord des demandes de retrait — ST 7.3 « Procédure
 * notice-and-takedown ». Réservé aux modérateurs (la page serveur a vérifié la
 * session et le rôle). Consomme `GET/POST /api/admin/demandes-retrait` et
 * `GET /api/admin/demandes-retrait/rapport`.
 *
 * `fetchImpl` : point d'injection pour les tests.
 */
export interface DemandesRetraitDashboardProps {
  fetchImpl?: typeof fetch;
}

const CARD_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-4)",
  background: "var(--surface-card)",
  border: "var(--border-hard)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-hard-sm)",
};

const META_STYLE: CSSProperties = {
  fontSize: "var(--text-caption)",
  color: "var(--text-muted)",
};

const LIBELLES_STATUT: Record<StatutDemandeRetrait, string> = {
  EN_ATTENTE: "En attente",
  TRAITEE: "Traitée (contenu retiré)",
  REJETEE: "Rejetée",
};

export function DemandesRetraitDashboard({ fetchImpl }: DemandesRetraitDashboardProps) {
  const doFetch = useMemo(
    () => fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined),
    [fetchImpl]
  );

  const [statut, setStatut] = useState<StatutDemandeRetrait>("EN_ATTENTE");
  const [file, setFile] = useState<FileDemandesRetraitResponse | null>(null);
  const [rapport, setRapport] = useState<RapportDelaisTraitement | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);
  const [commentaires, setCommentaires] = useState<Record<string, string>>({});

  const charger = useCallback(async () => {
    if (!doFetch) {
      setErreur("Le tableau de bord est indisponible.");
      setChargement(false);
      return;
    }
    setChargement(true);
    setErreur(null);
    try {
      const [fileRes, rapportRes] = await Promise.all([
        doFetch(`${DEMANDES_RETRAIT_ADMIN_API_PATH}?statut=${statut}`, {
          headers: { Accept: "application/json" },
        }),
        doFetch(DEMANDES_RETRAIT_RAPPORT_API_PATH, {
          headers: { Accept: "application/json" },
        }),
      ]);
      if (!fileRes.ok) {
        const data = (await fileRes.json().catch(() => ({}))) as { error?: string };
        setErreur(data.error ?? "Impossible de charger les demandes.");
        setFile(null);
        return;
      }
      setFile((await fileRes.json()) as FileDemandesRetraitResponse);
      if (rapportRes.ok) {
        setRapport((await rapportRes.json()) as RapportDelaisTraitement);
      }
    } catch {
      setErreur("Impossible de charger les demandes. Vérifiez votre connexion.");
      setFile(null);
    } finally {
      setChargement(false);
    }
  }, [doFetch, statut]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = useCallback(
    async (action: ActionDemandeRetrait, demande: DemandeRetraitModereView) => {
      if (!doFetch) return;
      setActionEnCours(`${demande.id}:${action}`);
      setMessage(null);
      setErreur(null);
      try {
        const res = await doFetch(DEMANDES_RETRAIT_ADMIN_API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            demandeId: demande.id,
            commentaire: commentaires[demande.id]?.trim() || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setErreur(data.error ?? "L'action a échoué.");
          return;
        }
        setMessage(
          action === "TRAITER"
            ? "Contenu retiré et demande close."
            : "Demande rejetée."
        );
        await charger();
      } catch {
        setErreur("L'action a échoué. Vérifiez votre connexion.");
      } finally {
        setActionEnCours(null);
      }
    },
    [doFetch, charger, commentaires]
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", width: "100%" }}>
      {rapport ? (
        <div style={{ ...CARD_STYLE }} data-testid="rapport-delais">
          <strong>Délais de traitement</strong>
          <p style={META_STYLE}>
            {rapport.total} demande{rapport.total > 1 ? "s" : ""} · {rapport.enAttente} en
            attente · {rapport.traitees} traitée{rapport.traitees > 1 ? "s" : ""} ·{" "}
            {rapport.rejetees} rejetée{rapport.rejetees > 1 ? "s" : ""}
          </p>
          <p style={META_STYLE}>
            Délai moyen :{" "}
            {rapport.delaiMoyenHeures === null ? "—" : `${rapport.delaiMoyenHeures} h`} ·
            médian :{" "}
            {rapport.delaiMedianHeures === null ? "—" : `${rapport.delaiMedianHeures} h`} ·
            max : {rapport.delaiMaxHeures === null ? "—" : `${rapport.delaiMaxHeures} h`}
          </p>
          <p style={META_STYLE}>
            Cible {rapport.delaiCibleHeures} h — {rapport.closesDansDelaiCible} dans les
            délais, {rapport.closesHorsDelaiCible} hors délai,{" "}
            {rapport.enAttenteHorsDelaiCible} en attente au-delà de la cible.
          </p>
        </div>
      ) : null}

      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <span style={META_STYLE}>Statut</span>
        <select
          value={statut}
          onChange={(e) => setStatut(e.target.value as StatutDemandeRetrait)}
        >
          {STATUTS_DEMANDE_RETRAIT.map((s) => (
            <option key={s} value={s}>
              {LIBELLES_STATUT[s]}
            </option>
          ))}
        </select>
      </label>

      {message ? (
        <p role="status" style={{ color: "var(--state-success, green)", margin: 0 }}>
          {message}
        </p>
      ) : null}
      {erreur ? (
        <p role="alert" style={{ color: "var(--state-danger)", margin: 0 }}>
          {erreur}
        </p>
      ) : null}

      {chargement ? (
        <p style={META_STYLE}>Chargement des demandes…</p>
      ) : file && file.items.length === 0 ? (
        <p style={META_STYLE}>Aucune demande pour ce filtre.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {file?.items.map((d) => {
            const busy = actionEnCours?.startsWith(`${d.id}:`) ?? false;
            const actionnable = d.statut === "EN_ATTENTE";
            return (
              <li key={d.id} style={CARD_STYLE}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)" }}>
                  <strong>
                    {d.contenuType === "EXTRAIT" ? "Extrait" : "Doublage"} · {d.contenuId}
                  </strong>
                  <span style={META_STYLE}>{LIBELLES_STATUT[d.statut]}</span>
                </div>
                <p style={{ margin: 0 }}>
                  <strong>Œuvre :</strong> {d.oeuvre}
                </p>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{d.motif}</p>
                <p style={META_STYLE}>
                  {d.demandeurNom}
                  {d.demandeurOrganisation ? ` (${d.demandeurOrganisation})` : ""} ·{" "}
                  {d.demandeurEmail} · reçue le{" "}
                  {new Date(d.dateCreation).toLocaleString("fr-FR")}
                  {d.delaiTraitementHeures !== null
                    ? ` · traitée en ${d.delaiTraitementHeures} h`
                    : ""}
                </p>
                {d.commentaireTraitement ? (
                  <p style={META_STYLE}>Note de clôture : {d.commentaireTraitement}</p>
                ) : null}
                {actionnable ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    <textarea
                      aria-label={`Commentaire de traitement pour la demande ${d.id}`}
                      placeholder="Commentaire de clôture (recommandé pour un rejet)"
                      rows={2}
                      value={commentaires[d.id] ?? ""}
                      onChange={(e) =>
                        setCommentaires((c) => ({ ...c, [d.id]: e.target.value }))
                      }
                      style={{ width: "100%", fontFamily: "var(--font-ui)" }}
                    />
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => void agir("TRAITER", d)}
                      >
                        Retirer le contenu
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void agir("REJETER", d)}
                      >
                        Rejeter la demande
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default DemandesRetraitDashboard;
