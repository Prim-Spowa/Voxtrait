import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ExtraitPageClient } from "../ExtraitPageClient";
import type { ExtraitDTO } from "@/types/extrait";
import type { ScriptResponse } from "@/types/script";
import type { FavorisResponse } from "@/lib/favoriClient";

// Tests de composant de la page `/extraits/:id` (ST 10.3, Definition of
// Done "tests de composant sur la page (rendu des quatre blocs, cas sans
// script, cas 404)"). Trois appels `fetch` sont déclenchés au montage, dans
// cet ordre : `GET /api/extraits/:id`, `GET /api/extraits/:id/script`, puis
// `GET /api/favoris` (ST 8.1) — cf. `ExtraitPageClient.tsx`.

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const anonyme = (): Response =>
  jsonResponse({ error: "Vous devez être connecté·e pour consulter vos favoris." }, false, 401);

const favorisVides: FavorisResponse = {
  items: [],
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
};

const extrait: ExtraitDTO = {
  id: "extrait-1",
  titre: "Mon Voisin Totoro",
  origine: "JP",
  type: "DESSIN_ANIME",
  source: "UPLOAD",
  urlSource: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  thumbnail: null,
  statut: "VALIDE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const scriptAvecLignes: ScriptResponse = {
  extraitId: "extrait-1",
  lignes: [
    { id: "l1", texte: "Bonjour !", timestampDebut: 0, timestampFin: 2 },
    { id: "l2", texte: "Comment ça va ?", timestampDebut: 2, timestampFin: 4 },
  ],
};

const scriptVide: ScriptResponse = { extraitId: "extrait-1", lignes: [] };

describe("ExtraitPageClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("affiche un état de chargement puis les quatre blocs du parcours", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(extrait));
    fetchMock.mockResolvedValueOnce(jsonResponse(scriptAvecLignes));
    fetchMock.mockResolvedValueOnce(anonyme());

    render(<ExtraitPageClient extraitId="extrait-1" />);

    expect(screen.getByRole("status")).toHaveTextContent(/chargement/i);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Mon Voisin Totoro" })).toBeInTheDocument();
    });

    // Bloc 1 — VideoPlayer (mode natif ici, source UPLOAD) : lecteur `<video>`.
    expect(document.querySelector("video")).not.toBeNull();
    // Bloc 2 — ScriptSynchronise : au moins la ligne active à t=0.
    expect(screen.getByTestId("script-synchronise")).toBeInTheDocument();
    // Bloc 3 — VoiceRecorder.
    expect(screen.getByTestId("voice-recorder")).toBeInTheDocument();
    // Bloc 4 — DoublageExport.
    expect(screen.getByTestId("doublage-export")).toBeInTheDocument();
  });

  it("affiche le message d'absence de script sans bloquer la page (cas « pas de script »)", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(extrait));
    fetchMock.mockResolvedValueOnce(jsonResponse(scriptVide));
    fetchMock.mockResolvedValueOnce(anonyme());

    render(<ExtraitPageClient extraitId="extrait-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("script-synchronise-vide")).toHaveTextContent(
        /aucun script n'est disponible/i
      );
    });
    // Le reste du parcours reste utilisable malgré l'absence de script.
    expect(screen.getByTestId("voice-recorder")).toBeInTheDocument();
    expect(screen.getByTestId("doublage-export")).toBeInTheDocument();
  });

  it("affiche un message « introuvable » quand l'extrait répond 404", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Extrait introuvable." }, false, 404)
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(scriptVide));
    fetchMock.mockResolvedValueOnce(anonyme());

    render(<ExtraitPageClient extraitId="inconnu" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /extrait introuvable/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /retour à la bibliothèque/i })).toHaveAttribute(
      "href",
      "/bibliotheque"
    );
    // Aucun des quatre blocs ne doit être monté sur un extrait introuvable.
    expect(screen.queryByTestId("voice-recorder")).not.toBeInTheDocument();
  });

  it("affiche le bouton favori pour un compte connecté (ST 8.1)", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(extrait));
    fetchMock.mockResolvedValueOnce(jsonResponse(scriptAvecLignes));
    fetchMock.mockResolvedValueOnce(jsonResponse(favorisVides));

    render(<ExtraitPageClient extraitId="extrait-1" />);

    const bouton = await screen.findByRole("button", { name: /ajouter aux favoris/i });
    expect(bouton).toHaveAttribute("aria-pressed", "false");
  });

  it("n'affiche aucun bouton favori pour un visiteur non connecté", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse(extrait));
    fetchMock.mockResolvedValueOnce(jsonResponse(scriptAvecLignes));
    fetchMock.mockResolvedValueOnce(anonyme());

    render(<ExtraitPageClient extraitId="extrait-1" />);

    await screen.findByRole("heading", { name: "Mon Voisin Totoro" });
    expect(
      screen.queryByRole("button", { name: /ajouter aux favoris/i })
    ).not.toBeInTheDocument();
  });
});
