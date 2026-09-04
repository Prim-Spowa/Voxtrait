"use client";

import { useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { SignalerButton } from "@/components/SignalerButton";
import { VIDEO_PLAYER_SCENARIOS } from "@/lib/mocks/videoPlayerScenarios";

/**
 * Client de la page de QA manuelle du lecteur vidéo (ST 1.2). Rendu isolé du
 * `page.tsx` (composant serveur) pour pouvoir tenir l'état des logs
 * d'évènements par scénario (play/pause/timeupdate/erreur), utile pour
 * vérifier à l'œil le comportement de chaque mode sans ouvrir la console.
 */
export function DevLecteurClient() {
  const [logsByScenario, setLogsByScenario] = useState<Record<string, string[]>>({});

  function log(scenarioId: string, message: string) {
    setLogsByScenario((prev) => {
      const line = `${new Date().toLocaleTimeString()} — ${message}`;
      const previousLines = prev[scenarioId] ?? [];
      return { ...prev, [scenarioId]: [line, ...previousLines].slice(0, 8) };
    });
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "2rem 1.5rem 4rem",
        display: "flex",
        flexDirection: "column",
        gap: "2.5rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header>
        <p
          style={{
            margin: "0 0 0.5rem",
            fontFamily: "monospace",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#888",
          }}
        >
          QA interne · DATA_SOURCE=mock uniquement
        </p>
        <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.5rem" }}>Lecteur vidéo — ST 1.2</h1>
        <p style={{ margin: 0, color: "#555" }}>
          Chaque bloc exerce un scénario du composant <code>VideoPlayer</code> : deux
          plateformes d&apos;embed distinctes, un embed bloqué, une lecture native, une
          source indisponible et une URL invalide (cf. Definition of Done de ST 1.2).
        </p>
      </header>

      {VIDEO_PLAYER_SCENARIOS.map((scenario) => (
        <section
          key={scenario.id}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            paddingBottom: "2rem",
            borderBottom: "1px solid #e0e0e0",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.1rem" }}>{scenario.label}</h2>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>{scenario.description}</p>
          </div>

          <VideoPlayer
            source={scenario.source}
            url={scenario.url}
            title={scenario.title}
            onPlay={() => log(scenario.id, "play")}
            onPause={() => log(scenario.id, "pause")}
            onTimeUpdate={(t) => log(scenario.id, `timeupdate: ${t.toFixed(1)}s`)}
            onError={(message) => log(scenario.id, `error: ${message}`)}
          />

          {/* ST 7.1 — action « signaler » sur le composant de lecture d'un
              extrait. Tant qu'aucune page publique de lecture d'extrait
              n'existe (cf. notes de dev ST 7.1), cette page de QA est la seule
              surface de rendu de `VideoPlayer` pour un extrait. */}
          <SignalerButton
            contenuType="EXTRAIT"
            contenuId={scenario.id}
            contenuTitre={scenario.title}
          />

          <ul
            data-testid={`log-${scenario.id}`}
            style={{
              margin: 0,
              padding: "0.5rem 0.75rem",
              listStyle: "none",
              background: "#f5f5f5",
              borderRadius: 4,
              fontFamily: "monospace",
              fontSize: "0.75rem",
              color: "#333",
              minHeight: "1.5rem",
            }}
          >
            {(logsByScenario[scenario.id] ?? []).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
