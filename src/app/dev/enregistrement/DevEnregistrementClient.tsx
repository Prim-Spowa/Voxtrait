"use client";

import { useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { VoiceRecorder, type RecordingResult } from "@/components/VoiceRecorder";
import {
  VOICE_RECORDER_SCENARIOS,
  type VoiceRecorderScenario,
} from "@/lib/mocks/voiceRecorderScenarios";

/**
 * Page de QA manuelle du module d'enregistrement vocal (ST 2.1), même rôle
 * que `DevLecteurClient` (ST 1.2) et `DevScriptSyncClient` (ST 1.3) : c'est
 * ici, au niveau de la page (et non du composant `VoiceRecorder` lui-même),
 * que `VideoPlayer` et `VoiceRecorder` sont assemblés — `currentVideoTime`
 * est levé depuis `onTimeUpdate` de `VideoPlayer` et transmis tel quel à
 * `VoiceRecorder`, exactement comme `time` l'est à `ScriptSynchronise`.
 *
 * Couvre le DoD "tests manuels multi-navigateurs (Chrome, Firefox, Safari)" :
 * à parcourir manuellement dans chacun des trois navigateurs cibles avant
 * validation de ST 2.1 (Safari en particulier, cf. limites connues de
 * `MediaRecorder` documentées dans `lib/voiceRecorder.ts`).
 */
export function DevEnregistrementClient() {
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
          Enregistrement vocal synchronisé — ST 2.1
        </h1>
        <p style={{ margin: 0, color: "#555" }}>
          Chaque bloc combine <code>VideoPlayer</code> (ST 1.2) et <code>VoiceRecorder</code>{" "}
          (ST 2.1) : autorisez le micro, lancez la lecture de l&apos;extrait pendant
          l&apos;enregistrement, puis arrêtez pour accéder à la prévisualisation.
        </p>
      </header>

      {VOICE_RECORDER_SCENARIOS.map((scenario) => (
        <ScenarioBlock key={scenario.id} scenario={scenario} />
      ))}
    </main>
  );
}

function ScenarioBlock({ scenario }: { scenario: VoiceRecorderScenario }) {
  const [time, setTime] = useState(0);
  const [completed, setCompleted] = useState<RecordingResult | null>(null);
  // Remise à zéro de la vidéo à l'appui sur « Recommencer » (ST 2.2,
  // `onRequestVideoReset`). `VideoPlayer` (ST 1.2) n'expose pas d'API de seek
  // impérative (ni ref, ni prop `currentTime` contrôlée) — on force donc un
  // remontage complet via `key` : un nouvel élément `<video>` reprend
  // naturellement à 0 (mode UPLOAD), et une iframe rechargée relance
  // l'horloge de secours à 0 (mode EMBED). Voir notes de dev ST 2.2, point à
  // valider : un remontage réinitialise aussi l'état interne du lecteur
  // (ex. `manualPlaying` en mode EMBED), ce qui est le comportement voulu ici
  // mais resterait à confirmer si `VideoPlayer` gagne un jour un état à
  // préserver entre deux resets (ex. volume choisi par l'utilisateur).
  const [resetKey, setResetKey] = useState(0);

  function resetVideo() {
    setResetKey((key) => key + 1);
    setTime(0);
  }

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
        key={resetKey}
        source={scenario.source}
        url={scenario.url}
        title={scenario.title}
        onTimeUpdate={setTime}
      />

      <p style={{ margin: 0, fontFamily: "monospace", fontSize: "0.8rem", color: "#333" }}>
        Position vidéo transmise au recorder : {time.toFixed(1)}s
      </p>

      <VoiceRecorder
        currentVideoTime={time}
        videoSource={scenario.source}
        videoUrl={scenario.url}
        videoTitle={scenario.title}
        onRecordingComplete={setCompleted}
        onRequestVideoReset={resetVideo}
      />

      {completed ? (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#555" }}>
          Dernier enregistrement : {completed.durationSeconds.toFixed(1)}s, démarré à{" "}
          {completed.startedAtVideoTimeSeconds.toFixed(1)}s de la vidéo ({completed.mimeType || "type MIME inconnu"}
          ).
        </p>
      ) : null}
    </section>
  );
}

export default DevEnregistrementClient;
