import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceRecorder } from "../VoiceRecorder";
import type { MediaRecorderLike } from "@/lib/voiceRecorder";
import type { AudioBlobStore } from "@/lib/audioBlobStore";

// Tests de composant du module d'enregistrement vocal (ST 2.1, Definition of
// Done "Tests unitaires sur la logique de synchro (mock MediaRecorder)").
//
// `getUserMedia` / `MediaRecorder` ne sont pas implémentés par jsdom : les
// dépendances navigateur sont donc injectées via les props prévues à cet
// effet (`getUserMedia`, `createMediaRecorder`, `isTypeSupported`), même
// convention que `embedLoadTimeoutMs` pour `VideoPlayer` (ST 1.2).

/** Fabrique un `MediaRecorderLike` dont l'état reflète les appels start()/stop(). */
function createFakeRecorder(): MediaRecorderLike {
  const holder = {
    _state: "inactive" as MediaRecorderLike["state"],
    ondataavailable: null as MediaRecorderLike["ondataavailable"],
    onstop: null as MediaRecorderLike["onstop"],
    onerror: null as MediaRecorderLike["onerror"],
    start: vi.fn(),
    stop: vi.fn(),
  };
  Object.defineProperty(holder, "state", { get: () => holder._state });
  holder.start.mockImplementation(() => {
    holder._state = "recording";
  });
  holder.stop.mockImplementation(() => {
    holder._state = "inactive";
    holder.ondataavailable?.({ data: new Blob(["chunk"], { type: "audio/webm" }) });
    holder.onstop?.();
  });
  return holder as unknown as MediaRecorderLike;
}

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

/** Comme `fakeStream`, mais expose les mocks `stop()` des pistes pour les tests de reset (ST 2.2). */
function fakeStreamWithSpies() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, tracks };
}

function fakeStore(): AudioBlobStore {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  // jsdom n'implémente pas la lecture réelle des éléments média : `play()`
  // lève "not implemented" sans mock, et `createObjectURL` est absent.
  window.HTMLMediaElement.prototype.play = vi
    .fn()
    .mockResolvedValue(undefined) as unknown as () => Promise<void>;
  window.HTMLMediaElement.prototype.pause = vi.fn() as unknown as () => void;
  window.URL.createObjectURL = vi.fn(() => "blob:mock-url") as unknown as typeof URL.createObjectURL;
  window.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
});

describe("VoiceRecorder — permission micro", () => {
  it("affiche le bouton d'activation du micro à l'état initial", () => {
    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
      />
    );

    expect(screen.getByRole("button", { name: /activer le micro/i })).toBeInTheDocument();
  });

  it("passe à l'état prêt après autorisation du micro", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());

    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(await screen.findByRole("button", { name: /démarrer l'enregistrement/i })).toBeInTheDocument();
  });

  it("affiche une erreur explicite et une option de réessai si la permission est refusée", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
        onError={onError}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/refusé/i);
    expect(screen.getByRole("button", { name: /réessayer/i })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/refusé/i));
  });
});

describe("VoiceRecorder — capture synchronisée", () => {
  it("démarre puis arrête l'enregistrement, en transmettant l'horodatage vidéo de départ", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const createMediaRecorder = vi.fn(() => createFakeRecorder());
    const isTypeSupported = vi.fn(() => true);
    const onRecordingComplete = vi.fn();

    render(
      <VoiceRecorder
        currentVideoTime={7.5}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
        createMediaRecorder={createMediaRecorder}
        isTypeSupported={isTypeSupported}
        onRecordingComplete={onRecordingComplete}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    await user.click(await screen.findByRole("button", { name: /démarrer l'enregistrement/i }));

    expect(screen.getByTestId("recording-indicator")).toBeInTheDocument();
    expect(createMediaRecorder).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /arrêter l'enregistrement/i }));

    expect(onRecordingComplete).toHaveBeenCalledWith(
      expect.objectContaining({ startedAtVideoTimeSeconds: 7.5 })
    );
    expect(await screen.findByTestId("voice-recorder-audio-only")).toBeInTheDocument();
  });

  it("arrête automatiquement l'enregistrement une fois la durée maximale atteinte", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const createMediaRecorder = vi.fn(() => createFakeRecorder());
    const isTypeSupported = vi.fn(() => true);
    const onRecordingComplete = vi.fn();

    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        maxDurationSeconds={1}
        getUserMedia={getUserMedia}
        createMediaRecorder={createMediaRecorder}
        isTypeSupported={isTypeSupported}
        onRecordingComplete={onRecordingComplete}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    // Flush la résolution de `getUserMedia` (microtâche) : sous timers factices,
    // `findByRole`/`waitFor` ne peuvent pas s'appuyer sur un vrai `setTimeout`
    // pour patienter — `act(async () => {})` vide la file de microtâches sans
    // dépendre de l'horloge.
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: /démarrer l'enregistrement/i }));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onRecordingComplete).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

describe("VoiceRecorder — prévisualisation combinée", () => {
  async function recordAndStop(props: {
    currentVideoTime: number;
    videoSource: "UPLOAD" | "EMBED";
  }) {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const createMediaRecorder = vi.fn(() => createFakeRecorder());
    const isTypeSupported = vi.fn(() => true);

    render(
      <VoiceRecorder
        currentVideoTime={props.currentVideoTime}
        videoSource={props.videoSource}
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
        createMediaRecorder={createMediaRecorder}
        isTypeSupported={isTypeSupported}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    await act(async () => {}); // flush la résolution de `getUserMedia` sous timers factices
    await user.click(screen.getByRole("button", { name: /démarrer l'enregistrement/i }));
    await user.click(screen.getByRole("button", { name: /arrêter l'enregistrement/i }));

    return { user };
  }

  it("rejoue la vidéo immédiatement puis retarde la piste vocale de l'écart de synchro (source UPLOAD)", async () => {
    vi.useFakeTimers();
    const { user } = await recordAndStop({ currentVideoTime: 3, videoSource: "UPLOAD" });

    const playMock = window.HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    playMock.mockClear();

    await user.click(screen.getByRole("button", { name: /lire la prévisualisation/i }));

    // La vidéo démarre tout de suite ; la voix, elle, attend l'écart de synchro (3 s).
    expect(playMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(playMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("affiche un message de repli sans prévisualisation combinée pour une source EMBED", async () => {
    vi.useFakeTimers();
    await recordAndStop({ currentVideoTime: 3, videoSource: "EMBED" });

    expect(screen.getByText(/prévisualisation combinée non disponible/i)).toBeInTheDocument();
    expect(screen.queryByTestId("voice-recorder-preview-video")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lire la prévisualisation/i })).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe("VoiceRecorder — action « Recommencer » (ST 2.2)", () => {
  it("ne propose pas Recommencer à l'état initial ni après activation du micro (affordances déjà existantes)", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());

    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
      />
    );

    expect(screen.queryByRole("button", { name: /recommencer/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    await screen.findByRole("button", { name: /démarrer l'enregistrement/i });

    expect(screen.queryByRole("button", { name: /recommencer/i })).not.toBeInTheDocument();
  });

  it("pendant l'enregistrement : libère le micro, n'appelle pas onRecordingComplete, et revient à l'état initial", async () => {
    const user = userEvent.setup();
    const { stream, tracks } = fakeStreamWithSpies();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const createMediaRecorder = vi.fn(() => createFakeRecorder());
    const isTypeSupported = vi.fn(() => true);
    const onRecordingComplete = vi.fn();
    const onRequestVideoReset = vi.fn();
    const store = fakeStore();

    render(
      <VoiceRecorder
        currentVideoTime={4.2}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
        createMediaRecorder={createMediaRecorder}
        isTypeSupported={isTypeSupported}
        onRecordingComplete={onRecordingComplete}
        onRequestVideoReset={onRequestVideoReset}
        store={store}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    await user.click(await screen.findByRole("button", { name: /démarrer l'enregistrement/i }));
    expect(screen.getByTestId("recording-indicator")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /recommencer/i }));

    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
    expect(onRecordingComplete).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(onRequestVideoReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /activer le micro/i })).toBeInTheDocument();
    expect(screen.queryByTestId("recording-indicator")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /recommencer/i })).not.toBeInTheDocument();
  });

  it("après un enregistrement terminé : écarte la prévisualisation et supprime le blob du store", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const createMediaRecorder = vi.fn(() => createFakeRecorder());
    const isTypeSupported = vi.fn(() => true);
    const store = fakeStore();

    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
        createMediaRecorder={createMediaRecorder}
        isTypeSupported={isTypeSupported}
        store={store}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    await user.click(await screen.findByRole("button", { name: /démarrer l'enregistrement/i }));
    await user.click(screen.getByRole("button", { name: /arrêter l'enregistrement/i }));

    expect(await screen.findByTestId("voice-recorder-audio-only")).toBeInTheDocument();
    expect(store.save).toHaveBeenCalledTimes(1);
    const savedId = (store.save as ReturnType<typeof vi.fn>).mock.calls[0][0];

    await user.click(screen.getByRole("button", { name: /recommencer/i }));

    expect(store.remove).toHaveBeenCalledWith(savedId);
    expect(screen.queryByTestId("voice-recorder-audio-only")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activer le micro/i })).toBeInTheDocument();
  });

  it("après une erreur en cours d'enregistrement : repasse à l'état initial", async () => {
    const user = userEvent.setup();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const recorder = createFakeRecorder();
    const createMediaRecorder = vi.fn(() => recorder);
    const isTypeSupported = vi.fn(() => true);

    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
        createMediaRecorder={createMediaRecorder}
        isTypeSupported={isTypeSupported}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    await user.click(await screen.findByRole("button", { name: /démarrer l'enregistrement/i }));

    act(() => {
      recorder.onerror?.({ error: new DOMException("busy", "NotReadableError") });
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /recommencer/i }));

    expect(screen.getByRole("button", { name: /activer le micro/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un double clic sur Recommencer ne relâche pas deux fois le même flux micro", async () => {
    const user = userEvent.setup();
    const { stream, tracks } = fakeStreamWithSpies();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const createMediaRecorder = vi.fn(() => createFakeRecorder());
    const isTypeSupported = vi.fn(() => true);

    render(
      <VoiceRecorder
        currentVideoTime={0}
        videoSource="UPLOAD"
        videoUrl="https://cdn.example.com/extraits/1.mp4"
        videoTitle="Un extrait"
        getUserMedia={getUserMedia}
        createMediaRecorder={createMediaRecorder}
        isTypeSupported={isTypeSupported}
      />
    );

    await user.click(screen.getByRole("button", { name: /activer le micro/i }));
    await user.click(await screen.findByRole("button", { name: /démarrer l'enregistrement/i }));
    await user.click(screen.getByRole("button", { name: /recommencer/i }));

    // Le bouton Recommencer a disparu (retour à idle) : un enregistrement
    // repart de zéro avant qu'un second reset ne puisse s'appliquer.
    expect(screen.queryByRole("button", { name: /recommencer/i })).not.toBeInTheDocument();
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1));
  });
});

afterEach(() => {
  vi.useRealTimers();
});
