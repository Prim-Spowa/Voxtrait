import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModerationDashboard } from "../ModerationDashboard";
import {
  MODERATION_API_PATH,
  type SignalementModereView,
} from "@/lib/moderationClient";

// ST 7.2 — dashboard client. `fetch` injecté (même convention que
// SignalerButton, ST 7.1).

const SIGNALEMENT: SignalementModereView = {
  id: "sig-1",
  contenuType: "EXTRAIT",
  contenuId: "extrait-42",
  motif: "Contenu choquant",
  auteurId: "user-3",
  statut: "EN_ATTENTE",
  dateCreation: "2026-09-04T09:00:00.000Z",
  nombreSignalementsContenu: 2,
};

function fileFetch(items = [SIGNALEMENT]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items,
          pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
        }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        decision: { id: "dec-1", action: "REJET_SIGNALEMENT" },
        signalement: { ...SIGNALEMENT, statut: "REJETE" },
      }),
    } as Response;
  });
}

describe("ModerationDashboard", () => {
  it("charge et affiche la file avec motif, regroupement et auteur", async () => {
    render(<ModerationDashboard fetchImpl={fileFetch() as unknown as typeof fetch} />);

    expect(await screen.findByText("Contenu choquant")).toBeInTheDocument();
    expect(screen.getByText(/2 signalements sur ce contenu/i)).toBeInTheDocument();
    expect(screen.getByText(/auteur user-3/i)).toBeInTheDocument();
  });

  it("affiche un message quand la file est vide", async () => {
    render(<ModerationDashboard fetchImpl={fileFetch([]) as unknown as typeof fetch} />);
    expect(await screen.findByText(/Aucun signalement/i)).toBeInTheDocument();
  });

  it("envoie l'action REJETER puis recharge la file", async () => {
    const fetchImpl = fileFetch();
    render(<ModerationDashboard fetchImpl={fetchImpl as unknown as typeof fetch} />);

    const carte = (await screen.findByText("Contenu choquant")).closest("li")!;
    await userEvent.click(within(carte).getByRole("button", { name: /Rejeter/i }));

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(
          ([url, init]) => url === MODERATION_API_PATH && (init as RequestInit)?.method === "POST"
        )
      ).toBe(true)
    );
    const post = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "POST"
    )!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      action: "REJETER",
      signalementId: "sig-1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/Décision enregistrée/i);
  });

  it("affiche l'erreur serveur si l'action échoue (ex. 409 déjà traité)", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [SIGNALEMENT],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
        } as Response;
      }
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: "Le signalement a déjà été traité (statut RETENU)." }),
      } as Response;
    });

    render(<ModerationDashboard fetchImpl={fetchImpl as unknown as typeof fetch} />);
    const carte = (await screen.findByText("Contenu choquant")).closest("li")!;
    await userEvent.click(within(carte).getByRole("button", { name: /Rejeter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/déjà été traité/i);
  });

  it("désactive « Suspendre le compte » pour un signalement anonyme", async () => {
    const anonyme = { ...SIGNALEMENT, id: "sig-2", auteurId: null };
    render(<ModerationDashboard fetchImpl={fileFetch([anonyme]) as unknown as typeof fetch} />);

    const carte = (await screen.findByText("Contenu choquant")).closest("li")!;
    expect(
      within(carte).getByRole("button", { name: /Suspendre le compte/i })
    ).toBeDisabled();
  });
});
