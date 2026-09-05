"use client";

import { useEffect, useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { ScriptSynchronise } from "@/components/ScriptSynchronise";
import { VoiceRecorder, type RecordingResult } from "@/components/VoiceRecorder";
import { DoublageExport } from "@/components/DoublageExport";
import { FavoriButton } from "@/components/FavoriButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { buildExtraitApiUrl } from "@/lib/extraitsClient";
import {
  buildFavorisApiUrl,
  FAVORIS_PAGE_SIZE_MAX,
  type FavorisResponse,
} from "@/lib/favoriClient";
import { ORIGINE_LABELS, TYPE_LABELS, type ExtraitDTO } from "@/types/extrait";
import type { ScriptLigneDTO, ScriptResponse } from "@/types/script";

/**
 * Assemblage client de la page `/extraits/:id` (ST 10.3), même rôle que
 * `DevEnregistrementClient` (ST 2.1) — lever `currentVideoTime` depuis
 * `onTimeUpdate` de `VideoPlayer` et le transmettre à `ScriptSynchronise` et
 * `VoiceRecorder` — mais adossé aux vraies données de l'extrait (`GET
 * /api/extraits/:id`, `GET /api/extraits/:id/script`) plutôt qu'à des
 * scénarios de QA fixes, et exposé publiquement (pas de garde `NODE_ENV`).
 *
 * Récupère les deux ressources en parallèle au montage. `GET
 * /api/extraits/:id/script` répond toujours `200` (tableau vide si aucun
 * script, cf. `lib/script.ts`) : seul l'échec de `GET /api/extraits/:id`
 * (404 — introuvable ou non validé) fait basculer la page en état
 * "introuvable", conformément au découpage en tâches de la story.
 */
export interface ExtraitPageClientProps {
  extraitId: string;
}

type Status = "loading" | "not-found" | "error" | "ready";

const PAGE_STYLE = {
  flex: 1,
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: "var(--space-5) var(--gutter-page) var(--space-10)",
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-5)",
};

/**
 * Aside « Le script » de la mise en page `DubScreen` : le script complet dans
 * une `Card`, la réplique correspondant à l'instant courant surlignée. C'est le
 * pendant statique du prompteur (`ScriptSynchronise`) rendu sous la vidéo.
 */
function ScriptCard({ lignes, time }: { lignes: ScriptLigneDTO[]; time: number }) {
  return (
    <Card variant="raised" padding="var(--space-4)">
      <h2 style={{ fontSize: "var(--text-subtitle)", margin: "0 0 var(--space-3)" }}>Le script</h2>
      {lignes.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--text-body-sm)", color: "var(--text-muted)" }}>
          Aucun script n&apos;est disponible pour cet extrait.
        </p>
      ) : (
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {lignes.map((ligne) => {
            const active = time >= ligne.timestampDebut && time < ligne.timestampFin;
            return (
              <li
                key={ligne.id}
                style={{
                  display: "flex",
                  gap: "var(--space-3)",
                  padding: "6px 8px",
                  background: active ? "var(--accent-secondary-soft)" : "transparent",
                  borderRadius: "var(--radius-xs)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-micro)",
                    color: "var(--text-muted)",
                    flex: "0 0 34px",
                  }}
                >
                  {ligne.timestampDebut.toFixed(1)}
                </span>
                <span style={{ fontSize: "var(--text-body-sm)" }}>{ligne.texte}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export function ExtraitPageClient({ extraitId }: ExtraitPageClientProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [extrait, setExtrait] = useState<ExtraitDTO | null>(null);
  const [lignes, setLignes] = useState<ScriptLigneDTO[]>([]);

  const [time, setTime] = useState(0);
  const [completed, setCompleted] = useState<RecordingResult | null>(null);
  // Remise à zéro de la vidéo à l'appui sur « Recommencer » (ST 2.2) : même
  // stratégie de remontage par `key` que `DevEnregistrementClient` — voir ce
  // fichier pour la discussion complète du choix.
  const [resetKey, setResetKey] = useState(0);

  // ST 8.1 — même logique que `BibliothequeListing` : un visiteur anonyme
  // reçoit un `401` de `GET /api/favoris` et n'a simplement pas de bouton
  // favori affiché, sans que cela bloque la consultation de la page.
  const [favori, setFavori] = useState(false);
  const [favoriDisponible, setFavoriDisponible] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      setStatus("loading");
      try {
        const [extraitRes, scriptRes] = await Promise.all([
          fetch(buildExtraitApiUrl(extraitId), { signal: controller.signal }),
          fetch(`/api/extraits/${encodeURIComponent(extraitId)}/script`, {
            signal: controller.signal,
          }),
        ]);

        if (!extraitRes.ok) {
          setStatus(extraitRes.status === 404 ? "not-found" : "error");
          return;
        }

        const extraitBody: ExtraitDTO = await extraitRes.json();
        // Un script indisponible ne doit pas empêcher l'affichage de la page
        // (cf. US 1.3, cas « pas de script disponible ») : tableau vide en
        // repli plutôt que de propager l'échec.
        const scriptBody: ScriptResponse | null = scriptRes.ok
          ? await scriptRes.json()
          : null;

        setExtrait(extraitBody);
        setLignes(scriptBody?.lignes ?? []);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
      }
    })();

    return () => controller.abort();
  }, [extraitId]);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(buildFavorisApiUrl({ pageSize: FAVORIS_PAGE_SIZE_MAX }), {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body: FavorisResponse = await res.json();
        setFavori(body.items.some((item) => item.extraitId === extraitId));
        setFavoriDisponible(true);
      } catch {
        // AbortError au démontage, ou échec réseau : bouton favori masqué.
      }
    })();

    return () => controller.abort();
  }, [extraitId]);

  function resetVideo() {
    setResetKey((key) => key + 1);
    setTime(0);
  }

  if (status === "loading") {
    return (
      <main style={PAGE_STYLE}>
        <p
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            margin: 0,
            color: "var(--text-secondary)",
          }}
        >
          <Icon name="loader" size={16} />
          Chargement de l&apos;extrait…
        </p>
      </main>
    );
  }

  if (status === "not-found") {
    return (
      <main style={PAGE_STYLE}>
        <Card
          variant="raised"
          padding="var(--space-10) var(--space-6)"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "var(--space-3)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "var(--text-title)" }}>Extrait introuvable</h1>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            Cet extrait n&apos;existe pas, ou n&apos;est plus disponible.
          </p>
          <a
            href="/bibliotheque"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Icon name="arrow-left" size={15} />
            Retour à la bibliothèque
          </a>
        </Card>
      </main>
    );
  }

  if (status === "error" || !extrait) {
    return (
      <main style={PAGE_STYLE}>
        <p
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            margin: 0,
            padding: "var(--space-3) var(--space-4)",
            background: "var(--surface-card)",
            border: "2px solid var(--state-danger)",
            borderRadius: "var(--radius-control)",
            color: "var(--text-primary)",
            fontSize: "var(--text-body)",
          }}
        >
          <Icon name="alert-triangle" size={16} color="var(--state-danger)" />
          L&apos;extrait n&apos;a pas pu être chargé. Réessayez plus tard.
        </p>
      </main>
    );
  }

  return (
    <main style={PAGE_STYLE}>
      {/* Barre d'actions (mise en page `DubScreen` du design system). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <Button
          variant="ghost"
          size="sm"
          icon="arrow-left"
          onClick={() => window.location.assign("/bibliotheque")}
        >
          Bibliothèque
        </Button>
        <Badge
          style={{
            background: `var(--origin-${extrait.origine.toLowerCase()})`,
            color: "var(--ink-950)",
          }}
        >
          {ORIGINE_LABELS[extrait.origine]}
        </Badge>
        <span style={{ fontSize: "var(--text-body-sm)", color: "var(--text-secondary)" }}>
          {TYPE_LABELS[extrait.type]}
        </span>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
          }}
        >
          {/* ST 8.1 — bouton favori, même contrat que sur la bibliothèque. */}
          {favoriDisponible ? (
            <FavoriButton extraitId={extrait.id} initialFavori={favori} onChange={setFavori} />
          ) : null}
        </div>
      </div>

      {/* Deux colonnes : scène + prise à gauche, script complet à droite. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: "var(--space-5)",
          alignItems: "start",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
            minWidth: 0,
          }}
        >
          <h1 style={{ margin: 0, fontSize: "var(--text-display-md)" }}>{extrait.titre}</h1>

          <VideoPlayer
            key={resetKey}
            source={extrait.source}
            url={extrait.urlSource}
            title={extrait.titre}
            poster={extrait.thumbnail}
            onTimeUpdate={setTime}
          />

          <ScriptSynchronise lignes={lignes} time={time} />

          <VoiceRecorder
            currentVideoTime={time}
            videoSource={extrait.source}
            videoUrl={extrait.urlSource}
            videoTitle={extrait.titre}
            onRecordingComplete={setCompleted}
            onRequestVideoReset={resetVideo}
          />

          {/* Export du doublage (ST 3.1/ST 10.4) : visiteur non connecté inclus,
              cf. cahier des charges. La sauvegarde privée (ST 6.1) exige un
              compte : `connecte` réutilise le signal `favoriDisponible`
              (`GET /api/favoris` répond `401` pour un visiteur anonyme). */}
          <DoublageExport
            extraitId={extrait.id}
            extraitTitre={extrait.titre}
            recording={completed}
            connecte={favoriDisponible}
          />
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <ScriptCard lignes={lignes} time={time} />
        </aside>
      </div>
    </main>
  );
}

export default ExtraitPageClient;
