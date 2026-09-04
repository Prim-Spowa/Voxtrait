import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemandeRetraitForm } from "../DemandeRetraitForm";
import { DEMANDES_RETRAIT_API_PATH } from "@/lib/demandeRetraitClient";

// ST 7.3 — formulaire public de demande de retrait. `fetch` est injecté.

function okFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ demande: { id: "demande-retrait-1" } }),
  });
}

async function remplirChamps() {
  await userEvent.type(screen.getByLabelText(/Identifiant/i), "extrait-42");
  await userEvent.type(screen.getByLabelText(/titre du film/i), "Le Grand Bleu");
  await userEvent.type(screen.getByLabelText(/Votre nom/i), "Ada Lovelace");
  await userEvent.type(screen.getByLabelText(/Email de contact/i), "ada@example.com");
  await userEvent.type(screen.getByLabelText(/Exposé de la demande/i), "Je détiens les droits.");
}

describe("DemandeRetraitForm", () => {
  it("bloque l'envoi tant que la déclaration de bonne foi n'est pas cochée", async () => {
    const fetchImpl = okFetch();
    render(<DemandeRetraitForm fetchImpl={fetchImpl} />);
    await remplirChamps();

    await userEvent.click(
      screen.getByRole("button", { name: /Envoyer la demande de retrait/i })
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/bonne foi|titulaire des droits/i);
  });

  it("envoie la demande puis affiche l'accusé de réception avec la référence", async () => {
    const fetchImpl = okFetch();
    render(<DemandeRetraitForm contenuTypeInitial="DOUBLAGE" fetchImpl={fetchImpl} />);
    await remplirChamps();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      screen.getByRole("button", { name: /Envoyer la demande de retrait/i })
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(DEMANDES_RETRAIT_API_PATH);
    expect(JSON.parse(init.body as string)).toMatchObject({
      contenuType: "DOUBLAGE",
      contenuId: "extrait-42",
      oeuvre: "Le Grand Bleu",
      demandeurNom: "Ada Lovelace",
      demandeurEmail: "ada@example.com",
      declarationBonneFoi: true,
    });

    expect(await screen.findByRole("status")).toHaveTextContent(/reçue/i);
    expect(screen.getByText(/demande-retrait-1/)).toBeInTheDocument();
  });

  it("affiche le message d'erreur serveur sur 400", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "L'email de contact ne paraît pas valide." }),
    });
    render(<DemandeRetraitForm fetchImpl={fetchImpl} />);
    await remplirChamps();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      screen.getByRole("button", { name: /Envoyer la demande de retrait/i })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/email de contact/i);
  });
});
