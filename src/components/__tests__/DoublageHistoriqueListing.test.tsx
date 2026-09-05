import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DoublageHistoriqueListing from "../DoublageHistoriqueListing";
import type { DoublageHistoriqueResponse } from "@/lib/doublageSauvegardeClient";

// Tests de composant du listing d'historique (ST 6.2, Definition of Done —
// « tests unitaires sur le endpoint de listing » + rendu des actions).
// Les assertions portent sur les rôles/libellés accessibles, pas sur les
// styles inline du design system.

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const emptyPage: DoublageHistoriqueResponse = {
  items: [],
  pagination: { page: 1, pageSize: 12, total: 0, totalPages: 1 },
};

const onePage: DoublageHistoriqueResponse = {
  items: [
    {
      id: "d1",
      extraitId: "e1",
      fichierUrl: "https://files.test/d1.mp4",
      visibilite: "PRIVEE",
      dateCreation: "2026-09-01T10:00:00.000Z",
      extraitTitre: "Réverbérations",
      extraitThumbnail: null,
      extraitOrigine: "US",
      extraitType: "FILM",
    },
  ],
  pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
};

describe("DoublageHistoriqueListing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("affiche un chargement puis la liste des doublages", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(onePage));

    render(<DoublageHistoriqueListing />);
    expect(screen.getByText(/chargement/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Réverbérations")).toBeInTheDocument();
    });
    // Appel bien ciblé sur le endpoint paginé « me ».
    expect(fetch).toHaveBeenCalledWith(
      "/api/doublages?utilisateur=me",
      expect.anything()
    );
  });

  it("propose les actions rejouer / télécharger / partager", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(onePage));
    render(<DoublageHistoriqueListing />);

    const item = await screen.findByRole("listitem");
    expect(within(item).getByRole("button", { name: /rejouer/i })).toBeInTheDocument();
    const download = within(item).getByRole("link", { name: /télécharger/i });
    expect(download).toHaveAttribute("href", "https://files.test/d1.mp4");
    expect(download).toHaveAttribute("download");
    expect(within(item).getByRole("button", { name: /partager/i })).toBeInTheDocument();
  });

  it("propose « Doubler à nouveau » vers /extraits/:id quand l'extrait existe (ST 11.2)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(onePage));
    render(<DoublageHistoriqueListing />);

    const item = await screen.findByRole("listitem");
    const lien = within(item).getByRole("link", { name: /doubler à nouveau/i });
    expect(lien).toHaveAttribute("href", "/extraits/e1");
  });

  it("masque « Doubler à nouveau » quand l'extrait d'origine a disparu (ST 11.2)", async () => {
    const extraitRetire: DoublageHistoriqueResponse = {
      items: [
        {
          ...onePage.items[0]!,
          extraitTitre: null,
          extraitOrigine: null,
          extraitType: null,
        },
      ],
      pagination: onePage.pagination,
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(extraitRetire));
    render(<DoublageHistoriqueListing />);

    const item = await screen.findByRole("listitem");
    expect(
      within(item).queryByRole("link", { name: /doubler à nouveau/i })
    ).not.toBeInTheDocument();
    // Les autres actions restent disponibles (rejouer le doublage sauvegardé).
    expect(within(item).getByRole("button", { name: /rejouer/i })).toBeInTheDocument();
  });

  it("déplie le lecteur vidéo au clic sur « Rejouer »", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(onePage));
    render(<DoublageHistoriqueListing />);

    const button = await screen.findByRole("button", { name: /rejouer/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("affiche un état vide invitant à parcourir la bibliothèque", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(emptyPage));
    render(<DoublageHistoriqueListing />);

    await waitFor(() => {
      expect(screen.getByText(/aucun doublage sauvegardé/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /bibliothèque/i })).toHaveAttribute(
      "href",
      "/bibliotheque"
    );
  });

  it("affiche l'erreur renvoyée par l'API", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: "Vous devez être connecté·e." }, false, 401)
    );
    render(<DoublageHistoriqueListing />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/connecté/i);
    });
  });

  it("navigue entre les pages", async () => {
    const twoPages: DoublageHistoriqueResponse = {
      ...onePage,
      pagination: { page: 1, pageSize: 12, total: 20, totalPages: 2 },
    };
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(twoPages))
      .mockResolvedValueOnce(
        jsonResponse({
          ...twoPages,
          pagination: { page: 2, pageSize: 12, total: 20, totalPages: 2 },
        })
      );

    render(<DoublageHistoriqueListing />);
    const next = await screen.findByRole("button", { name: /suivant/i });
    await userEvent.click(next);

    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith(
        "/api/doublages?utilisateur=me&page=2",
        expect.anything()
      );
    });
  });
});
