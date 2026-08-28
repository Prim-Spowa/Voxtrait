import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoublageShareButtons } from "../DoublageShareButtons";
import { SHARE_NETWORKS } from "@/lib/doublageShareClient";

// ST 3.2 — Web Share API + fallback boutons par réseau + copie du lien.
// `navigator`, presse-papiers et ouverture d'URL sont injectés.

const SHARE_URL = "https://voxtrait.test/doublage/job-1";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DoublageShareButtons", () => {
  it("affiche un lien pour chaque réseau du registre + un bouton copier", () => {
    render(<DoublageShareButtons shareUrl={SHARE_URL} extraitTitre="Réverbérations" />);
    for (const network of SHARE_NETWORKS) {
      expect(screen.getByRole("link", { name: network.label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Copier le lien/i })).toBeInTheDocument();
  });

  it("n'affiche pas le bouton « Partager » natif si la Web Share API est absente", () => {
    render(
      <DoublageShareButtons
        shareUrl={SHARE_URL}
        extraitTitre="Réverbérations"
        navigatorImpl={{}}
      />
    );
    expect(screen.queryByRole("button", { name: "Partager" })).not.toBeInTheDocument();
  });

  it("appelle navigator.share avec le payload quand la Web Share API est disponible", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    render(
      <DoublageShareButtons
        shareUrl={SHARE_URL}
        extraitTitre="Réverbérations"
        navigatorImpl={{ share }}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Partager" }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]![0]).toMatchObject({ url: SHARE_URL });
  });

  it("reste silencieux si l'utilisateur annule le partage natif", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const share = vi.fn().mockRejectedValue(abort);
    render(
      <DoublageShareButtons
        shareUrl={SHARE_URL}
        extraitTitre="Réverbérations"
        navigatorImpl={{ share }}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Partager" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("affiche une erreur si le partage natif échoue vraiment", async () => {
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <DoublageShareButtons
        shareUrl={SHARE_URL}
        extraitTitre="Réverbérations"
        navigatorImpl={{ share }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Partager" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/pas pu aboutir/i);
  });

  it("ouvre l'URL d'intent dans un onglet via openUrl (hors e-mail)", async () => {
    const openUrl = vi.fn();
    render(
      <DoublageShareButtons
        shareUrl={SHARE_URL}
        extraitTitre="Réverbérations"
        navigatorImpl={{}}
        openUrl={openUrl}
      />
    );

    await userEvent.click(screen.getByRole("link", { name: "X" }));
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining("twitter.com/intent/tweet"));

    await userEvent.click(screen.getByRole("link", { name: "E-mail" }));
    // `mailto:` : laissé au navigateur, openUrl non appelé.
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("copie le lien dans le presse-papiers et confirme visuellement", async () => {
    const clipboardImpl = vi.fn().mockResolvedValue(undefined);
    render(
      <DoublageShareButtons
        shareUrl={SHARE_URL}
        extraitTitre="Réverbérations"
        navigatorImpl={{}}
        clipboardImpl={clipboardImpl}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /Copier le lien/i }));
    expect(clipboardImpl).toHaveBeenCalledWith(SHARE_URL);
    expect(await screen.findByRole("button", { name: /Lien copié/i })).toBeInTheDocument();
  });
});
