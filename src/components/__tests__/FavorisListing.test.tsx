import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FavorisListing from "../FavorisListing";
import type { FavorisResponse } from "@/lib/favoriClient";

// Tests de composant du listing des favoris (ST 8.1, Definition of Done —
// « tests sur le listing paginé »). Les assertions portent sur les
// rôles/libellés accessibles, pas sur les styles inline du design system.

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const emptyPage: FavorisResponse = {
  items: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

const onePage: FavorisResponse = {
  items: [
    {
      id: "f1",
      extraitId: "e1",
      dateAjout: "2026-09-01T10:00:00.000Z",
      extraitTitre: "Réverbérations",
      extraitThumbnail: null,
      extraitOrigine: "US",
      extraitType: "FILM",
      extraitSource: "EMBED",
      extraitStatut: "VALIDE",
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

describe("FavorisListing", () => {
  it("affiche un chargement puis la liste des favoris", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(onePage));
    render(<FavorisListing fetchImpl={fetchImpl} />);
    expect(screen.getByText(/chargement/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Réverbérations")).toBeInTheDocument();
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/favoris", expect.anything());
  });

  it("affiche le total en badge", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(onePage));
    render(<FavorisListing fetchImpl={fetchImpl} />);

    await waitFor(() => expect(screen.getByText("1 favori")).toBeInTheDocument());
  });

  it("affiche le bouton favori (état déjà favori) et le titre de chaque carte", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(onePage));
    render(<FavorisListing fetchImpl={fetchImpl} />);

    const item = await screen.findByRole("listitem");
    expect(within(item).getByRole("heading", { name: "Réverbérations" })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: /retirer des favoris/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("retire un favori de la liste (retrait optimiste, sans re-fetch)", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(onePage)); // GET /api/favoris
    fetchImpl.mockResolvedValueOnce(jsonResponse({ removed: true })); // DELETE toggle
    render(<FavorisListing fetchImpl={fetchImpl} />);

    const bouton = await screen.findByRole("button", { name: /retirer des favoris/i });
    await userEvent.click(bouton);

    await waitFor(() => {
      expect(screen.queryByText("Réverbérations")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/aucun favori pour le moment/i)).toBeInTheDocument();
    // Un seul appel au listing paginé : le retrait ne re-fetch pas la page.
    expect(fetchImpl.mock.calls.filter(([url]) => url === "/api/favoris")).toHaveLength(1);
  });

  it("signale un extrait retiré par modération sans faire disparaître le favori", async () => {
    const favoriRetire: FavorisResponse = {
      items: [
        {
          ...onePage.items[0]!,
          extraitStatut: "RETRAIT_MODERATION",
        },
      ],
      pagination: onePage.pagination,
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(favoriRetire));
    render(<FavorisListing fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText("Réverbérations")).toBeInTheDocument();
    });
    expect(screen.getByText(/contenu retiré/i)).toBeInTheDocument();
  });

  it("affiche une carte de repli pour un extrait introuvable (supprimé)", async () => {
    const favoriIntrouvable: FavorisResponse = {
      items: [
        {
          id: "f2",
          extraitId: "e-404",
          dateAjout: "2026-09-01T10:00:00.000Z",
          extraitTitre: null,
          extraitThumbnail: null,
          extraitOrigine: null,
          extraitType: null,
          extraitSource: null,
          extraitStatut: null,
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(favoriIntrouvable));
    render(<FavorisListing fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText(/extrait introuvable/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retirer des favoris/i })).toBeInTheDocument();
  });

  it("affiche un état vide invitant à parcourir la bibliothèque", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(emptyPage));
    render(<FavorisListing fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByText(/aucun favori pour le moment/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /bibliothèque/i })).toHaveAttribute(
      "href",
      "/bibliotheque"
    );
  });

  it("affiche l'erreur renvoyée par l'API", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Vous devez être connecté·e." }, false, 401));
    render(<FavorisListing fetchImpl={fetchImpl} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/connecté/i);
    });
  });

  it("navigue entre les pages", async () => {
    const twoPages: FavorisResponse = {
      ...onePage,
      pagination: { page: 1, pageSize: 20, total: 30, totalPages: 2 },
    };
    const fetchImpl = vi.fn();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(twoPages))
      .mockResolvedValueOnce(
        jsonResponse({ ...twoPages, pagination: { page: 2, pageSize: 20, total: 30, totalPages: 2 } })
      );

    render(<FavorisListing fetchImpl={fetchImpl} />);
    const next = await screen.findByRole("button", { name: /suivant/i });
    await userEvent.click(next);

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenLastCalledWith("/api/favoris?page=2", expect.anything());
    });
  });
});
