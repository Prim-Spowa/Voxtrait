"use client";

import { useEffect, useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { ScriptSynchronise } from "@/components/ScriptSynchronise";
import { SCRIPT_SYNC_SCENARIOS, type ScriptSyncScenario } from "@/lib/mocks/scriptSyncScenarios";
import type { ScriptLigneDTO, ScriptResponse } from "@/types/script";

/**
 * Page de QA manuelle de la synchronisation script/dialogue (ST 1.3), même
 * rôle que `DevLecteurClient` pour ST 1.2 : vérifier à l'œil ce que les
 * tests automatisés couvrent en logique pure (`resolveActiveLineIndex`) mais
 * pas visuellement (rendu réel, enchaînement des répliques pendant une
 * lecture).
 *
 * N'existe pas dans le découpage en tâches de ST 1.3 (contrairement à
 * `/dev/lecteur`, explicitement demandé par le DoD de ST 1.2) — ajoutée par
 * cohérence avec la convention déjà établie par ST 1.2, pour faciliter la
 * revue de code et les tests manuels.
 */
export function DevScriptSyncClient() {
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
        <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.5rem" }}>
          Script synchronisé — ST 1.3
        </h1>
        <p style={{ margin: 0, color: "#555" }}>
          Chaque bloc combine <code>VideoPlayer</code> (ST 1.2) et{" "}
          <code>ScriptSynchronise</code> (ST 1.3) : la position de lecture du lecteur pilote la
          surbrillance du script. Un curseur manuel est fourni pour se positionner directement,
          sans dépendre de l&apos;horloge de secours du mode embed.
        </p>
      </header>

      {SCRIPT_SYNC_SCENARIOS.map((scenario) => (
        <ScenarioBlock key={scenario.id} scenario={scenario} />
      ))}
    </main>
  );
}

function ScenarioBlock({ scenario }: { scenario: ScriptSyncScenario }) {
  const [lignes, setLignes] = useState<ScriptLigneDTO[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/extraits/${encodeURIComponent(scenario.extraitId)}/script`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        return res.json();
      })
      .then((json: ScriptResponse) => setLignes(json.lignes))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Erreur inconnue");
      });
    return () => controller.abort();
  }, [scenario.extraitId]);

  return (
    <section
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
        onTimeUpdate={setTime}
      />

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <label htmlFor={`time-${scenario.id}`} style={{ fontSize: "0.8rem", color: "#555" }}>
          Position manuelle :
        </label>
        <input
          id={`time-${scenario.id}`}
          type="range"
          min={0}
          max={15}
          step={0.1}
          value={time}
          onChange={(e) => setTime(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#333", minWidth: "3.5em" }}>
          {time.toFixed(1)}s
        </span>
      </div>

      {loadError ? (
        <p role="alert" style={{ margin: 0, color: "#b00020" }}>
          Impossible de charger le script ({loadError}).
        </p>
      ) : lignes === null ? (
        <p style={{ margin: 0, color: "#555" }}>Chargement du script…</p>
      ) : (
        <ScriptSynchronise lignes={lignes} time={time} />
      )}
    </section>
  );
}

export default DevScriptSyncClient;
