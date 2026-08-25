import { describe, expect, it, vi } from "vitest";
import {
  canResetRecording,
  computeAudioPlaybackDelayMs,
  describeMicrophoneError,
  formatElapsedLabel,
  hasReachedMaxDuration,
  pickSupportedMimeType,
  startRecordingSession,
  stopRecordingSilently,
  type MediaRecorderLike,
} from "../voiceRecorder";

// Tests unitaires de la logique du module d'enregistrement (ST 2.1,
// Definition of Done "Tests unitaires sur la logique de synchro (mock
// MediaRecorder)").

describe("describeMicrophoneError", () => {
  it("traduit un refus de permission", () => {
    const error = new DOMException("denied", "NotAllowedError");
    expect(describeMicrophoneError(error)).toMatch(/refusé/i);
  });

  it("traduit l'absence de microphone détecté", () => {
    const error = new DOMException("no device", "NotFoundError");
    expect(describeMicrophoneError(error)).toMatch(/aucun microphone/i);
  });

  it("traduit un microphone déjà utilisé par une autre application", () => {
    const error = new DOMException("busy", "NotReadableError");
    expect(describeMicrophoneError(error)).toMatch(/déjà utilisé/i);
  });

  it("traduit une contrainte de sécurité (HTTPS requis)", () => {
    const error = new DOMException("insecure", "SecurityError");
    expect(describeMicrophoneError(error)).toMatch(/https/i);
  });

  it("traduit une interruption de la demande", () => {
    const error = new DOMException("aborted", "AbortError");
    expect(describeMicrophoneError(error)).toMatch(/interrompue/i);
  });

  it("retombe sur un message générique incluant le message d'origine pour une Error non reconnue", () => {
    const error = new Error("quelque chose d'inattendu");
    expect(describeMicrophoneError(error)).toMatch(/quelque chose d'inattendu/);
  });

  it("retombe sur un message générique pour une valeur qui n'est ni DOMException ni Error", () => {
    expect(describeMicrophoneError("erreur brute")).toMatch(/raison inconnue/i);
    expect(describeMicrophoneError(undefined)).toMatch(/raison inconnue/i);
  });
});

describe("pickSupportedMimeType", () => {
  it("retourne le premier candidat supporté", () => {
    const isTypeSupported = vi.fn((type: string) => type === "audio/webm");
    expect(
      pickSupportedMimeType(isTypeSupported, ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"])
    ).toBe("audio/webm");
  });

  it("retourne le premier candidat si plusieurs sont supportés", () => {
    const isTypeSupported = vi.fn(() => true);
    expect(pickSupportedMimeType(isTypeSupported, ["a", "b"])).toBe("a");
  });

  it("retourne null si aucun candidat n'est supporté (cas Safari sans repli connu)", () => {
    const isTypeSupported = vi.fn(() => false);
    expect(pickSupportedMimeType(isTypeSupported, ["a", "b"])).toBeNull();
  });
});

/** Fabrique un `MediaRecorderLike` minimal, entièrement piloté par le test. */
function createFakeRecorder(): MediaRecorderLike {
  return {
    state: "inactive",
    start: vi.fn(),
    stop: vi.fn(),
    ondataavailable: null,
    onstop: null,
    onerror: null,
  };
}

describe("startRecordingSession", () => {
  it("démarre le recorder et conserve la position vidéo de départ", () => {
    const recorder = createFakeRecorder();
    const session = startRecordingSession(recorder, 42.5, "audio/webm");

    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(session.startedAtVideoTimeSeconds).toBe(42.5);
    expect(session.mimeType).toBe("audio/webm");
  });

  it("assemble les morceaux reçus en un seul blob à l'arrêt", async () => {
    const recorder = createFakeRecorder();
    const onStop = vi.fn();
    startRecordingSession(recorder, 0, "audio/webm", { onStop });

    recorder.ondataavailable?.({ data: new Blob(["abc"], { type: "audio/webm" }) });
    recorder.ondataavailable?.({ data: new Blob(["def"], { type: "audio/webm" }) });
    recorder.onstop?.();

    expect(onStop).toHaveBeenCalledTimes(1);
    const blob = onStop.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("audio/webm");
    expect(blob.size).toBe(6);
  });

  it("ignore les morceaux vides (data.size === 0)", () => {
    const recorder = createFakeRecorder();
    const onStop = vi.fn();
    startRecordingSession(recorder, 0, "audio/webm", { onStop });

    recorder.ondataavailable?.({ data: new Blob([], { type: "audio/webm" }) });
    recorder.onstop?.();

    const blob = onStop.mock.calls[0][0] as Blob;
    expect(blob.size).toBe(0);
  });

  it("traduit une erreur du recorder via describeMicrophoneError", () => {
    const recorder = createFakeRecorder();
    const onError = vi.fn();
    startRecordingSession(recorder, 0, "audio/webm", { onError });

    recorder.onerror?.({ error: new DOMException("busy", "NotReadableError") });

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/déjà utilisé/i));
  });
});

describe("hasReachedMaxDuration", () => {
  it("retourne false tant que la durée maximale n'est pas atteinte", () => {
    expect(hasReachedMaxDuration(299, 300)).toBe(false);
  });

  it("retourne true à la durée maximale exacte", () => {
    expect(hasReachedMaxDuration(300, 300)).toBe(true);
  });

  it("retourne true au-delà de la durée maximale", () => {
    expect(hasReachedMaxDuration(301, 300)).toBe(true);
  });

  it("utilise 300s par défaut si aucune limite n'est fournie", () => {
    expect(hasReachedMaxDuration(300)).toBe(true);
    expect(hasReachedMaxDuration(299.9)).toBe(false);
  });
});

describe("computeAudioPlaybackDelayMs", () => {
  it("convertit des secondes en millisecondes", () => {
    expect(computeAudioPlaybackDelayMs(2.345)).toBe(2345);
  });

  it("retourne 0 pour un départ vidéo à zéro", () => {
    expect(computeAudioPlaybackDelayMs(0)).toBe(0);
  });

  it("ne retourne jamais de délai négatif", () => {
    expect(computeAudioPlaybackDelayMs(-5)).toBe(0);
  });
});

describe("formatElapsedLabel", () => {
  it("formate en mm:ss avec zéros de tête", () => {
    expect(formatElapsedLabel(5)).toBe("00:05");
    expect(formatElapsedLabel(65)).toBe("01:05");
    expect(formatElapsedLabel(300)).toBe("05:00");
  });

  it("plafonne à zéro pour une valeur négative", () => {
    expect(formatElapsedLabel(-10)).toBe("00:00");
  });
});

// Tests unitaires de l'action « Recommencer » (ST 2.2, Definition of Done
// "Test unitaire sur la réinitialisation d'état").

describe("canResetRecording", () => {
  it("autorise le reset pendant l'enregistrement, sur un résultat, ou après une erreur", () => {
    expect(canResetRecording("recording")).toBe(true);
    expect(canResetRecording("stopped")).toBe(true);
    expect(canResetRecording("error")).toBe(true);
  });

  it("n'autorise pas le reset quand il n'y a rien à réinitialiser", () => {
    expect(canResetRecording("idle")).toBe(false);
    expect(canResetRecording("requesting-permission")).toBe(false);
  });

  it("n'autorise pas le reset depuis 'ready' ou 'permission-denied' (affordances déjà existantes)", () => {
    expect(canResetRecording("ready")).toBe(false);
    expect(canResetRecording("permission-denied")).toBe(false);
  });
});

/**
 * Fabrique un `MediaRecorderLike` dont `state` est mutable (contrairement à
 * `createFakeRecorder` ci-dessus, dont l'état reste `"inactive"` pour les
 * tests de `startRecordingSession`) — nécessaire ici pour simuler un
 * enregistrement en cours au moment du reset.
 */
function createMutableStateRecorder(
  initialState: MediaRecorderLike["state"]
): MediaRecorderLike {
  const holder = {
    _state: initialState,
    ondataavailable: null as MediaRecorderLike["ondataavailable"],
    onstop: null as MediaRecorderLike["onstop"],
    onerror: null as MediaRecorderLike["onerror"],
    start: vi.fn(),
    stop: vi.fn(),
  };
  Object.defineProperty(holder, "state", { get: () => holder._state });
  return holder as unknown as MediaRecorderLike;
}

describe("stopRecordingSilently", () => {
  it("arrête un recorder en cours sans déclencher onstop/onerror", () => {
    const recorder = createMutableStateRecorder("recording");
    const onStop = vi.fn();
    const onError = vi.fn();
    recorder.onstop = onStop;
    recorder.onerror = onError;
    // Simule le comportement réel : `stop()` déclenche les handlers alors
    // attachés — le test vérifie donc que `stopRecordingSilently` les a bien
    // détachés avant d'appeler `stop()`.
    (recorder.stop as ReturnType<typeof vi.fn>).mockImplementation(() => {
      recorder.ondataavailable?.({ data: new Blob(["abandon"]) });
      recorder.onstop?.();
    });

    stopRecordingSilently(recorder);

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("ne fait rien pour un recorder déjà inactif", () => {
    const recorder = createMutableStateRecorder("inactive");

    stopRecordingSilently(recorder);

    expect(recorder.stop).not.toHaveBeenCalled();
  });

  it("ne fait rien pour un recorder null (reset depuis un état sans enregistrement en cours)", () => {
    expect(() => stopRecordingSilently(null)).not.toThrow();
  });
});
