import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoPlayer } from "../VideoPlayer";

// Tests de composant du lecteur vidéo (ST 1.2, Definition of Done "Tests sur
// les deux modes de lecture").
//
// Comme pour BibliothequeListing (ST 1.1), les assertions portent sur le
// comportement et les rôles/libellés accessibles, pas sur les styles inline.

describe("VideoPlayer — validation de la source", () => {
  it("affiche une erreur et n'essaie pas de charger si l'URL est absente", () => {
    const onError = vi.fn();
    render(<VideoPlayer source="UPLOAD" url="" title="Un extrait" onError={onError} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/aucune source/i);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/aucune source/i));
  });

  it("affiche une erreur si l'URL est syntaxiquement invalide", () => {
    const onError = vi.fn();
    render(<VideoPlayer source="EMBED" url="pas-une-url" title="Un extrait" onError={onError} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/invalide/i);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("VideoPlayer — mode natif (source UPLOAD)", () => {
  it("rend un lecteur HTML5 natif avec les contrôles et le libellé accessible", () => {
    const { container } = render(
      <VideoPlayer
        source="UPLOAD"
        url="https://cdn.example.com/extraits/1.mp4"
        title="Mon Voisin Totoro"
        poster="https://cdn.example.com/extraits/1.jpg"
      />
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("aria-label", "Mon Voisin Totoro");
    expect(video).toHaveAttribute("poster", "https://cdn.example.com/extraits/1.jpg");
    expect(video).toHaveAttribute("controls");
  });

  it("normalise et remonte les évènements play/pause/timeupdate", () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onTimeUpdate = vi.fn();

    const { container } = render(
      <VideoPlayer
        source="UPLOAD"
        url="https://cdn.example.com/extraits/1.mp4"
        title="Un extrait"
        onPlay={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
      />
    );

    const video = container.querySelector("video")!;

    fireEvent.play(video);
    expect(onPlay).toHaveBeenCalledTimes(1);

    fireEvent.pause(video);
    expect(onPause).toHaveBeenCalledTimes(1);

    Object.defineProperty(video, "currentTime", { value: 12.5, configurable: true });
    fireEvent.timeUpdate(video);
    expect(onTimeUpdate).toHaveBeenCalledWith(12.5);
  });

  it("affiche une erreur et arrête le lecteur si la source ne charge pas", () => {
    const onError = vi.fn();
    const { container } = render(
      <VideoPlayer
        source="UPLOAD"
        url="https://cdn.example.com/extraits/introuvable.mp4"
        title="Un extrait"
        onError={onError}
      />
    );

    const video = container.querySelector("video")!;
    fireEvent.error(video);

    expect(screen.getByRole("alert")).toHaveTextContent(/n'a pas pu être chargée/i);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.querySelector("video")).toBeNull();
  });
});

describe("VideoPlayer — mode embed (source EMBED)", () => {
  it("rend une iframe avec un titre accessible", () => {
    const { container } = render(
      <VideoPlayer source="EMBED" url="https://embed.example.com/1" title="Un extrait embarqué" />
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute("title", "Un extrait embarqué");
    expect(iframe).toHaveAttribute("src", "https://embed.example.com/1");
  });

  it("affiche une erreur si l'iframe déclenche un évènement error", () => {
    const onError = vi.fn();
    const { container } = render(
      <VideoPlayer source="EMBED" url="https://embed.example.com/1" title="Un extrait" onError={onError} />
    );

    fireEvent.error(container.querySelector("iframe")!);

    expect(screen.getByRole("alert")).toHaveTextContent(/n'a pas pu être chargée/i);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("traite l'absence de chargement au-delà du délai comme un échec (embed potentiellement bloqué)", () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    render(
      <VideoPlayer
        source="EMBED"
        url="https://embed.example.com/1"
        title="Un extrait"
        embedLoadTimeoutMs={1000}
        onError={onError}
      />
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/expiré/i);
    expect(onError).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("n'affiche pas d'erreur si l'iframe charge avant le délai", () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    const { container } = render(
      <VideoPlayer
        source="EMBED"
        url="https://embed.example.com/1"
        title="Un extrait"
        embedLoadTimeoutMs={1000}
        onError={onError}
      />
    );

    act(() => {
      fireEvent.load(container.querySelector("iframe")!);
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("propose une horloge de secours pilotée manuellement (pas d'API de timing fiable en embed)", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onTimeUpdate = vi.fn();

    render(
      <VideoPlayer
        source="EMBED"
        url="https://embed.example.com/1"
        title="Un extrait"
        onPlay={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
      />
    );

    const toggle = screen.getByRole("button", { name: /signaler le début de la lecture/i });
    await user.click(toggle);

    expect(onPlay).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onTimeUpdate).toHaveBeenCalled();
    const lastCall = onTimeUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeCloseTo(1, 1);

    const pauseButton = screen.getByRole("button", { name: /signaler la pause/i });
    await user.click(pauseButton);
    expect(onPause).toHaveBeenCalledTimes(1);

    const callsAtPause = onTimeUpdate.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Aucun nouveau tick une fois la pause signalée.
    expect(onTimeUpdate.mock.calls.length).toBe(callsAtPause);

    vi.useRealTimers();
  });
});
