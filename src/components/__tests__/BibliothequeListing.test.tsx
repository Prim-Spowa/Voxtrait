import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BibliothequeListing from "../BibliothequeListing";
import type { ExtraitsResponse } from "@/types/extrait";
import type { FavorisResponse } from "@/lib/favoriClient";

// Tests de composant du listing bibliothèque (ST 1.1, Definition of Done
// "tests de composant sur le listing"). Depuis ST 8.1, le montage déclenche
// aussi — indépendamment des filtres — un appel à `GET /api/favoris` (état de
// connexion + favoris déjà posés) : c'est toujours le PREMIER appel `fetch`
// (cf. `BibliothequeListing.tsx`, ordre des effets), les extraits arrivent en
// second. `anonyme()` le stub par défaut (visiteur non connecté, `401`) pour
// les tests qui ne portent pas sur les favoris.
//
// Les assertions portent sur le comportement et sur les rôles/libellés
// accessibles, jamais sur les styles inline du design system : l'habillage doit
// pouvoir évoluer sans casser la suite.

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

/** Réponse `401` de `GET /api/favoris` — visiteur anonyme (cf. tête de fichier). */
function anonyme(): Response {
  return jsonResponse(
    { error: "Vous devez être connecté·e pour consulter vos favoris." },
    false,
    401
  );
}

const favorisVides: FavorisResponse = {
  items: [],
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
};

const emptyPage: ExtraitsResponse = {
  items: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

/** Colonne de filtres `SideNav` du design system (ST 11.1). */
function filterColumn() {
  return within(screen.getByRole("navigation", { name: /filtrer la bibliothèque/i }));
}

/** Liste des filtres actifs rappelés au-dessus de la grille. */
function activeFilterList() {
  return within(screen.getByRole("list", { name: "Filtres actifs" }));
}

const onePage: ExtraitsResponse = {
  items: [
    {
      id: "1",
      titre: "Mon Voisin Totoro",
      origine: "JP",
      type: "DESSIN_ANIME",
      source: "EMBED",
      urlSource: "https://example.com/1",
      thumbnail: null,
      statut: "VALIDE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};

describe("BibliothequeListing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("affiche un état de chargement puis les résultats", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValueOnce(jsonResponse(onePage));

    render(<BibliothequeListing />);

    expect(screen.getByText(/chargement/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Mon Voisin Totoro")).toBeInTheDocument();
    });
  });

  it("affiche un message si aucun résultat", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyPage));

    render(<BibliothequeListing />);

    await waitFor(() => {
      expect(screen.getByText(/aucun extrait ne correspond/i)).toBeInTheDocument();
    });
  });

  it("affiche un message d'erreur si l'appel API échoue", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Paramètre invalide" }, false, 400)
    );

    render(<BibliothequeListing />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Paramètre invalide");
    });
  });

  it("relance l'appel API avec le filtre origine sélectionné", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValue(jsonResponse(emptyPage));

    render(<BibliothequeListing />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const user = userEvent.setup();
    await user.click(filterColumn().getByRole("button", { name: "Japon" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const lastCallUrl = fetchMock.mock.calls[2][0] as string;
    expect(lastCallUrl).toContain("origine=JP");
  });

  it("réinitialise la page à 1 lors d'un changement de filtre", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 100, totalPages: 5 },
      })
    );

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /suivant/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toContain("page=2");

    await user.click(filterColumn().getByRole("button", { name: "Film" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).not.toContain("page=2");
  });

  // --- Intégration du design system « Doublure arcade » ---

  it("rend chaque extrait comme une vignette portant son code d'origine", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValueOnce(jsonResponse(onePage));

    render(<BibliothequeListing />);

    const card = await screen.findByRole("article");
    expect(within(card).getByRole("heading", { name: "Mon Voisin Totoro" })).toBeInTheDocument();
    // Code couleur d'origine du catalogue : le badge affiche le code brut.
    expect(within(card).getByText("JP")).toBeInTheDocument();
    expect(within(card).getByText("Dessin animé")).toBeInTheDocument();
  });

  it("relie chaque carte à la page publique de l'extrait (ST 10.3)", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValueOnce(jsonResponse(onePage));

    render(<BibliothequeListing />);

    const lien = await screen.findByRole("link", { name: /mon voisin totoro/i });
    expect(lien).toHaveAttribute("href", "/extraits/1");
  });

  it("retombe sur la vignette de remplacement quand l'extrait n'a pas de thumbnail", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValueOnce(jsonResponse(onePage));

    render(<BibliothequeListing />);

    const card = await screen.findByRole("article");
    // Requête DOM directe : une image `alt=""` est volontairement absente de
    // l'arbre d'accessibilité, donc inatteignable par `getByRole`.
    const img = card.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/assets/placeholder-thumb.svg");
    // alt vide volontaire : la vignette est redondante avec le titre.
    expect(img).toHaveAttribute("alt", "");
  });

  it("affiche le total en badge et rappelle les filtres actifs sous forme de tags", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValue(jsonResponse(onePage));

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(screen.getByText("1 extrait")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(filterColumn().getByRole("button", { name: "Japon" }));

    // Filtre rappelé en tag supprimable au-dessus de la grille.
    const tag = await activeFilterList().findByRole("button", { name: /japon/i });
    expect(tag).toHaveAttribute("aria-pressed", "true");
  });

  it("efface un filtre quand on retire son tag", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValue(jsonResponse(onePage));

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const user = userEvent.setup();
    await user.click(filterColumn().getByRole("button", { name: "Japon" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Retirer le tag rappelé au-dessus de la grille efface le filtre.
    await user.click(await activeFilterList().findByRole("button", { name: /japon/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).not.toContain("origine=");
    expect(screen.queryByRole("list", { name: "Filtres actifs" })).not.toBeInTheDocument();
    expect(filterColumn().getByRole("button", { name: "Japon" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("propose d'effacer les filtres depuis l'état vide", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(anonyme());
    fetchMock.mockResolvedValue(jsonResponse(emptyPage));

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Sans filtre actif, l'état vide n'offre pas de raccourci de réinitialisation.
    expect(screen.queryByRole("button", { name: /effacer les filtres/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(filterColumn().getByRole("button", { name: "Film" }));

    const reset = await screen.findByRole("button", { name: /effacer les filtres/i });
    await user.click(reset);

    await waitFor(() => {
      expect(filterColumn().getByRole("button", { name: "Film" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
  });

  // --- ST 8.1 : bouton favori sur la carte d'extrait ---

  describe("bouton favori (ST 8.1)", () => {
    it("n'affiche aucun bouton favori pour un visiteur non connecté", async () => {
      const fetchMock = fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(anonyme());
      fetchMock.mockResolvedValueOnce(jsonResponse(onePage));

      render(<BibliothequeListing />);

      await screen.findByRole("article");
      expect(
        screen.queryByRole("button", { name: /ajouter aux favoris/i })
      ).not.toBeInTheDocument();
    });

    it("affiche le bouton favori (état vide) pour un compte connecté sans favori", async () => {
      const fetchMock = fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(jsonResponse(favorisVides));
      fetchMock.mockResolvedValueOnce(jsonResponse(onePage));

      render(<BibliothequeListing />);

      const bouton = await screen.findByRole("button", { name: /ajouter aux favoris/i });
      expect(bouton).toHaveAttribute("aria-pressed", "false");
    });

    it("affiche l'état « déjà favori » pour un extrait déjà présent dans les favoris", async () => {
      const fetchMock = fetch as ReturnType<typeof vi.fn>;
      const favorisAvecItem1: FavorisResponse = {
        items: [
          {
            id: "f1",
            extraitId: "1",
            dateAjout: "2026-01-01T00:00:00.000Z",
            extraitTitre: "Mon Voisin Totoro",
            extraitThumbnail: null,
            extraitOrigine: "JP",
            extraitType: "DESSIN_ANIME",
            extraitSource: "EMBED",
            extraitStatut: "VALIDE",
          },
        ],
        pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(favorisAvecItem1));
      fetchMock.mockResolvedValueOnce(jsonResponse(onePage));

      render(<BibliothequeListing />);

      const bouton = await screen.findByRole("button", { name: /retirer des favoris/i });
      expect(bouton).toHaveAttribute("aria-pressed", "true");
    });

    it("bascule l'état au clic (POST puis PATCH visuel)", async () => {
      const fetchMock = fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(jsonResponse(favorisVides));
      fetchMock.mockResolvedValueOnce(jsonResponse(onePage));
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ favori: { id: "f1", extraitId: "1", dateAjout: "2026-01-01T00:00:00.000Z" } })
      );

      render(<BibliothequeListing />);

      const bouton = await screen.findByRole("button", { name: /ajouter aux favoris/i });
      const user = userEvent.setup();
      await user.click(bouton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /retirer des favoris/i })).toHaveAttribute(
          "aria-pressed",
          "true"
        );
      });
      expect(fetchMock.mock.calls[2]).toEqual([
        "/api/extraits/1/favori",
        expect.objectContaining({ method: "POST" }),
      ]);
    });

    it("rétablit l'état précédent si la bascule échoue", async () => {
      const fetchMock = fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValueOnce(jsonResponse(favorisVides));
      fetchMock.mockResolvedValueOnce(jsonResponse(onePage));
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Erreur serveur" }, false, 500));

      render(<BibliothequeListing />);

      const bouton = await screen.findByRole("button", { name: /ajouter aux favoris/i });
      const user = userEvent.setup();
      await user.click(bouton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /ajouter aux favoris/i })).toHaveAttribute(
          "aria-pressed",
          "false"
        );
      });
      expect(screen.getByRole("alert")).toHaveTextContent(/erreur serveur/i);
    });
  });
});
