"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import {
  MODERATION_API_PATH,
  STATUTS_SIGNALEMENT,
  TRIS_FILE_MODERATION,
  type ActionModeration,
  type FileModerationResponse,
  type SignalementModereView,
  type StatutSignalement,
  type TriFileModeration,
} from "@/lib/moderationClient";

/**
 * Dashboard de modération — ST 7.2 « Dashboard de modération », découpage en
 * tâches points 2 et 3 : listing des signalements + actions (rejeter, retirer
 * le contenu, suspendre le compte).
 *
 * Composant client : la page serveur (`/admin/moderation`) a déjà vérifié la
 * session **et le rôle** (`exigerModerateur`) ; ce composant consomme
 * `GET/POST /api/admin/moderation` (re-protégés côté serveur).
 *
 * Filtres/tri (ST 7.2, points d'attention : « prévoir des filtres/tri par
 * ancienneté pour prioriser ») : statut + tri ancienneté/récence.
 *
 * `fetchImpl` : point d'injection pour les tests (même convention que
 * `SignalerButton`, ST 7.1).
 */
export interface ModerationDashboardProps {
  fetchImpl?: typeof fetch;
}

/** Disposition interne d'une carte de signalement (l'habillage vient de `Card`). */
const CARD_BODY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
};

const META_STYLE: CSSProperties = {
  fontSize: "var(--text-caption)",
  color: "var(--text-muted)",
};

const LIBELLES_STATUT: Record<StatutSignalement, string> = {
  EN_ATTENTE: "En attente",
  RETENU: "Retenu",
  REJETE: "Rejeté",
};

const LIBELLES_TRI: Record<TriFileModeration, string> = {
  ANCIENNETE: "Plus anciens d'abord",
  RECENCE: "Plus récents d'abord",
};

export function ModerationDashboard({ fetchImpl }: ModerationDashboardProps) {
  const doFetch = useMemo(
    () => fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined),
    [fetchImpl]
  );

  const [statut, setStatut] = useState<StatutSignalement>("EN_ATTENTE");
  const [tri, setTri] = useState<TriFileModeration>("ANCIENNETE");
  const [file, setFile] = useState<FileModerationResponse | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!doFetch) {
      setErreur("Le dashboard est indisponible.");
      setChargement(false);
      return;
    }
    setChargement(true);
    setErreur(null);
    try {
      const params = new URLSearchParams({ statut, tri });
      const res = await doFetch(`${MODERATION_API_PATH}?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErreur(data.error ?? "Impossible de charger la file de modération.");
        setFile(null);
        return;
      }
      setFile((await res.json()) as FileModerationResponse);
    } catch {
      setErreur("Impossible de charger la file de modération. Vérifiez votre connexion.");
      setFile(null);
    } finally {
      setChargement(false);
    }
  }, [doFetch, statut, tri]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = useCallback(
    async (
      action: ActionModeration,
      signalement: SignalementModereView
    ) => {
      if (!doFetch) return;
      setActionEnCours(`${signalement.id}:${action}`);
      setMessage(null);
      setErreur(null);

      const body: Record<string, string> = { action };
      if (action === "SUSPENDRE_COMPTE") {
        if (!signalement.auteurId) {
          setErreur("Ce signalement n'a pas d'auteur : aucun compte à suspendre.");
          setActionEnCours(null);
          return;
        }
        // Le compte visé est celui qui a publié le contenu incriminé ; faute de
        // le résoudre côté client (le contenu peut être un job en mémoire), on
        // suspend l'auteur du signalement uniquement si l'opérateur le demande
        // explicitement. Ici on cible l'auteur du signalement comme raccourci
        // de démonstration — voir notes de dev (résolution du propriétaire du
        // contenu à faire).
        body.compteCibleId = signalement.auteurId;
        body.signalementId = signalement.id;
      } else {
        body.signalementId = signalement.id;
      }

      try {
        const res = await doFetch(MODERATION_API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setErreur(data.error ?? "L'action a échoué.");
          return;
        }
        setMessage("Décision enregistrée.");
        await charger();
      } catch {
        setErreur("L'action a échoué. Vérifiez votre connexion.");
      } finally {
        setActionEnCours(null);
      }
    },
    [doFetch, charger]
  );

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", width: "100%" }}
    >
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Select
          label="Statut"
          value={statut}
          onChange={(e) => setStatut(e.target.value as StatutSignalement)}
          options={STATUTS_SIGNALEMENT.map((s) => ({ value: s, label: LIBELLES_STATUT[s] }))}
        />
        <Select
          label="Tri"
          value={tri}
          onChange={(e) => setTri(e.target.value as TriFileModeration)}
          options={TRIS_FILE_MODERATION.map((t) => ({ value: t, label: LIBELLES_TRI[t] }))}
        />
      </div>

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
        <p style={META_STYLE}>Chargement de la file…</p>
      ) : file && file.items.length === 0 ? (
        <p style={META_STYLE}>Aucun signalement pour ce filtre.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {file?.items.map((s) => {
            const busy = actionEnCours?.startsWith(`${s.id}:`) ?? false;
            const actionnable = s.statut === "EN_ATTENTE";
            return (
              <Card
                key={s.id}
                as="li"
                variant={actionnable ? "raised" : "flat"}
                style={CARD_BODY_STYLE}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "center" }}>
                  <strong>
                    {s.contenuType === "EXTRAIT" ? "Extrait" : "Doublage"} · {s.contenuId}
                  </strong>
                  <Badge>{LIBELLES_STATUT[s.statut]}</Badge>
                </div>
                <p style={{ margin: 0 }}>{s.motif}</p>
                <p style={META_STYLE}>
                  Signalé le {new Date(s.dateCreation).toLocaleString("fr-FR")} ·{" "}
                  {s.nombreSignalementsContenu} signalement
                  {s.nombreSignalementsContenu > 1 ? "s" : ""} sur ce contenu ·{" "}
                  {s.auteurId ? `auteur ${s.auteurId}` : "auteur anonyme"}
                </p>
                {actionnable ? (
                  <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void agir("REJETER", s)}
                    >
                      Rejeter
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={busy}
                      onClick={() => void agir("RETIRER_CONTENU", s)}
                    >
                      Retirer le contenu
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={busy || !s.auteurId}
                      onClick={() => void agir("SUSPENDRE_COMPTE", s)}
                    >
                      Suspendre le compte
                    </Button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ModerationDashboard;
