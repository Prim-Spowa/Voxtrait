import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BibliothequeListing from "../BibliothequeListing";
import type { ExtraitsResponse } from "@/types/extrait";

// Tests de composant du listing bibliothèque (ST 1.1, Definition of Done
// "tests de composant sur le listing").
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

const emptyPage: ExtraitsResponse = {
  items: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
};

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
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(onePage));

    render(<BibliothequeListing />);

    expect(screen.getByText(/chargement/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Mon Voisin Totoro")).toBeInTheDocument();
    });
  });

  it("affiche un message si aucun résultat", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(emptyPage));

    render(<BibliothequeListing />);

    await waitFor(() => {
      expect(screen.getByText(/aucun extrait ne correspond/i)).toBeInTheDocument();
    });
  });

  it("affiche un message d'erreur si l'appel API échoue", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: "Paramètre invalide" }, false, 400)
    );

    render(<BibliothequeListing />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Paramètre invalide");
    });
  });

  it("relance l'appel API avec le filtre origine sélectionné", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(emptyPage));

    render(<BibliothequeListing />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/origine/i), "JP");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const lastCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(lastCallUrl).toContain("origine=JP");
  });

  it("réinitialise la page à 1 lors d'un changement de filtre", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 100, totalPages: 5 },
      })
    );

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /suivant/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");

    await user.selectOptions(screen.getByLabelText(/type/i), "FILM");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).not.toContain("page=2");
  });

  // --- Intégration du design system « Doublure arcade » ---

  it("rend chaque extrait comme une vignette portant son code d'origine", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(onePage));

    render(<BibliothequeListing />);

    const card = await screen.findByRole("article");
    expect(within(card).getByRole("heading", { name: "Mon Voisin Totoro" })).toBeInTheDocument();
    // Code couleur d'origine du catalogue : le badge affiche le code brut.
    expect(within(card).getByText("JP")).toBeInTheDocument();
    expect(within(card).getByText("Dessin animé")).toBeInTheDocument();
  });

  it("retombe sur la vignette de remplacement quand l'extrait n'a pas de thumbnail", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(onePage));

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
    fetchMock.mockResolvedValue(jsonResponse(onePage));

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(screen.getByText("1 extrait")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/origine/i), "JP");

    const tag = await screen.findByRole("button", { name: /japon/i });
    expect(tag).toHaveAttribute("aria-pressed", "true");
  });

  it("efface un filtre quand on retire son tag", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(onePage));

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/origine/i), "JP");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await user.click(await screen.findByRole("button", { name: /japon/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).not.toContain("origine=");
    expect(screen.queryByRole("button", { name: /japon/i })).not.toBeInTheDocument();
  });

  it("propose d'effacer les filtres depuis l'état vide", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(emptyPage));

    render(<BibliothequeListing />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Sans filtre actif, l'état vide n'offre pas de raccourci de réinitialisation.
    expect(screen.queryByRole("button", { name: /effacer les filtres/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/type/i), "FILM");

    const reset = await screen.findByRole("button", { name: /effacer les filtres/i });
    await user.click(reset);

    await waitFor(() => {
      expect(screen.getByLabelText(/type/i)).toHaveValue("");
    });
  });
});
