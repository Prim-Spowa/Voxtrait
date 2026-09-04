import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemandesRetraitDashboard } from "../DemandesRetraitDashboard";
import {
  DEMANDES_RETRAIT_ADMIN_API_PATH,
  DEMANDES_RETRAIT_RAPPORT_API_PATH,
  type DemandeRetraitModereView,
} from "@/lib/demandeRetraitClient";

// ST 7.3 — tableau de bord des demandes de retrait. `fetch` injecté.

const DEMANDE: DemandeRetraitModereView = {
  id: "dr-1",
  contenuType: "EXTRAIT",
  contenuId: "extrait-42",
  oeuvre: "Le Grand Bleu",
  demandeurNom: "Ada Lovelace",
  demandeurEmail: "ada@example.com",
  demandeurOrganisation: "Studios ACME",
  motif: "Titulaire des droits.",
  declarationBonneFoi: true,
  statut: "EN_ATTENTE",
  commentaireTraitement: null,
  traiteeParId: null,
  dateCreation: "2026-09-04T09:00:00.000Z",
  dateTraitement: null,
  delaiTraitementHeures: null,
};

const RAPPORT = {
  total: 3,
  enAttente: 1,
  traitees: 2,
  rejetees: 0,
  delaiMoyenHeures: 12,
  delaiMedianHeures: 10,
  delaiMaxHeures: 30,
  closesDansDelaiCible: 2,
  closesHorsDelaiCible: 0,
  enAttenteHorsDelaiCible: 0,
  delaiCibleHeures: 72,
};

function dashboardFetch(items = [DEMANDE]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith(DEMANDES_RETRAIT_RAPPORT_API_PATH)) {
      return { ok: true, status: 200, json: async () => RAPPORT } as Response;
    }
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
        demande: { ...DEMANDE, statut: "TRAITEE" },
        decisionId: "dec-9",
      }),
    } as Response;
  });
}

describe("DemandesRetraitDashboard", () => {
  it("affiche le rapport de délais et la file", async () => {
    render(
      <DemandesRetraitDashboard fetchImpl={dashboardFetch() as unknown as typeof fetch} />
    );

    expect(await screen.findByTestId("rapport-delais")).toHaveTextContent(/Délai moyen : 12 h/);
    expect(screen.getByText(/Le Grand Bleu/)).toBeInTheDocument();
    expect(screen.getByText(/ada@example.com/)).toBeInTheDocument();
  });

  it("envoie l'action TRAITER avec le commentaire de clôture", async () => {
    const fetchImpl = dashboardFetch();
    render(
      <DemandesRetraitDashboard fetchImpl={fetchImpl as unknown as typeof fetch} />
    );

    const carte = (await screen.findByText(/Le Grand Bleu/)).closest("li")!;
    await userEvent.type(
      within(carte).getByLabelText(/Commentaire de traitement/i),
      "réclamation fondée"
    );
    await userEvent.click(
      within(carte).getByRole("button", { name: /Retirer le contenu/i })
    );

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(
          ([url, init]) =>
            url === DEMANDES_RETRAIT_ADMIN_API_PATH &&
            (init as RequestInit)?.method === "POST"
        )
      ).toBe(true)
    );
    const post = fetchImpl.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "POST"
    )!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      action: "TRAITER",
      demandeId: "dr-1",
      commentaire: "réclamation fondée",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/Contenu retiré/i);
  });

  it("affiche un message quand la file est vide", async () => {
    render(
      <DemandesRetraitDashboard fetchImpl={dashboardFetch([]) as unknown as typeof fetch} />
    );
    expect(await screen.findByText(/Aucune demande pour ce filtre/i)).toBeInTheDocument();
  });
});
