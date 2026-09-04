import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FavoriButton } from "../FavoriButton";

// ST 8.1 — bouton favori (bascule ajout/retrait). `fetch` est injecté (même
// convention que `SignalerButton`, ST 7.1).

function okFetch(body: unknown = { favori: { id: "f1", extraitId: "mock-1", dateAjout: "" } }) {
  return vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => body });
}

describe("FavoriButton", () => {
  it("affiche l'état vide par défaut", () => {
    render(<FavoriButton extraitId="mock-1" initialFavori={false} fetchImpl={okFetch()} />);
    const bouton = screen.getByRole("button", { name: /ajouter aux favoris/i });
    expect(bouton).toHaveAttribute("aria-pressed", "false");
  });

  it("affiche l'état « déjà favori » quand initialFavori est vrai", () => {
    render(<FavoriButton extraitId="mock-1" initialFavori fetchImpl={okFetch()} />);
    const bouton = screen.getByRole("button", { name: /retirer des favoris/i });
    expect(bouton).toHaveAttribute("aria-pressed", "true");
  });

  it("ajoute le favori (POST) au clic depuis l'état vide", async () => {
    const fetchImpl = okFetch();
    render(<FavoriButton extraitId="mock-1" initialFavori={false} fetchImpl={fetchImpl} />);

    await userEvent.click(screen.getByRole("button", { name: /ajouter aux favoris/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retirer des favoris/i })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/extraits/mock-1/favori",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("retire le favori (DELETE) au clic depuis l'état déjà favori", async () => {
    const fetchImpl = okFetch({ removed: true });
    render(<FavoriButton extraitId="mock-1" initialFavori fetchImpl={fetchImpl} />);

    await userEvent.click(screen.getByRole("button", { name: /retirer des favoris/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /ajouter aux favoris/i })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/extraits/mock-1/favori",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("notifie l'appelant (onChange) à chaque bascule réussie", async () => {
    const onChange = vi.fn();
    render(
      <FavoriButton
        extraitId="mock-1"
        initialFavori={false}
        onChange={onChange}
        fetchImpl={okFetch()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /ajouter aux favoris/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
  });

  it("rétablit l'état précédent et affiche l'erreur serveur en cas d'échec", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Vous devez être connecté·e." }) });
    render(<FavoriButton extraitId="mock-1" initialFavori={false} fetchImpl={fetchImpl} />);

    await userEvent.click(screen.getByRole("button", { name: /ajouter aux favoris/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /ajouter aux favoris/i })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/connecté/i);
  });

  it("rétablit l'état précédent en cas d'erreur réseau", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    render(<FavoriButton extraitId="mock-1" initialFavori={false} fetchImpl={fetchImpl} />);

    await userEvent.click(screen.getByRole("button", { name: /ajouter aux favoris/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /ajouter aux favoris/i })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/network/i);
  });

  it("ignore un second clic pendant qu'une requête est en cours", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchImpl = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );
    render(<FavoriButton extraitId="mock-1" initialFavori={false} fetchImpl={fetchImpl} />);

    const bouton = screen.getByRole("button", { name: /ajouter aux favoris/i });
    await userEvent.click(bouton);
    await userEvent.click(bouton);

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, status: 201, json: async () => ({ favori: {} }) });
    await waitFor(() => expect(bouton).not.toBeDisabled());
  });

  it("se resynchronise si `initialFavori` change (nouvelle page de résultats)", () => {
    const { rerender } = render(
      <FavoriButton extraitId="mock-1" initialFavori={false} fetchImpl={okFetch()} />
    );
    expect(screen.getByRole("button", { name: /ajouter aux favoris/i })).toBeInTheDocument();

    rerender(<FavoriButton extraitId="mock-1" initialFavori fetchImpl={okFetch()} />);
    expect(screen.getByRole("button", { name: /retirer des favoris/i })).toBeInTheDocument();
  });
});
