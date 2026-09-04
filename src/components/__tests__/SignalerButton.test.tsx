import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignalerButton } from "../SignalerButton";
import { SIGNALEMENTS_API_PATH } from "@/lib/signalementClient";

// ST 7.1 — bouton/formulaire « Signaler » sur un composant de lecture.
// `fetch` est injecté.

function okFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ signalement: { id: "signalement-1" } }),
  });
}

async function ouvrirFormulaire() {
  await userEvent.click(screen.getByRole("button", { name: /Signaler/i }));
}

describe("SignalerButton", () => {
  it("est replié par défaut : pas de formulaire visible", () => {
    render(<SignalerButton contenuType="DOUBLAGE" contenuId="job-1" fetchImpl={okFetch()} />);
    expect(screen.queryByTestId("signaler-panel")).not.toBeInTheDocument();
  });

  it("déplie le formulaire au clic sur « Signaler »", async () => {
    render(<SignalerButton contenuType="DOUBLAGE" contenuId="job-1" fetchImpl={okFetch()} />);
    await ouvrirFormulaire();
    expect(screen.getByTestId("signaler-panel")).toBeInTheDocument();
  });

  it("bloque l'envoi si aucun motif n'est choisi (motif obligatoire)", async () => {
    const fetchImpl = okFetch();
    render(<SignalerButton contenuType="EXTRAIT" contenuId="mock-1" fetchImpl={fetchImpl} />);
    await ouvrirFormulaire();

    await userEvent.click(screen.getByRole("button", { name: /Envoyer le signalement/i }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/motif/i);
  });

  it("envoie le signalement avec le motif composé puis affiche l'accusé de réception", async () => {
    const fetchImpl = okFetch();
    render(
      <SignalerButton
        contenuType="EXTRAIT"
        contenuId="mock-42"
        contenuTitre="Réverbérations"
        fetchImpl={fetchImpl}
      />
    );
    await ouvrirFormulaire();

    await userEvent.selectOptions(
      screen.getByLabelText(/Motif/i),
      "Atteinte aux droits d'auteur"
    );
    await userEvent.type(screen.getByLabelText(/Précisions/i), "scène complète");
    await userEvent.click(screen.getByRole("button", { name: /Envoyer le signalement/i }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(SIGNALEMENTS_API_PATH);
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body as string)).toEqual({
      contenuType: "EXTRAIT",
      contenuId: "mock-42",
      motif: "Atteinte aux droits d'auteur — scène complète",
    });

    expect(await screen.findByRole("status")).toHaveTextContent(/transmis/i);
    expect(screen.queryByTestId("signaler-panel")).not.toBeInTheDocument();
  });

  it("affiche le message serveur en cas de 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "Trop de signalements envoyés. Réessayez plus tard." }),
    });
    render(<SignalerButton contenuType="DOUBLAGE" contenuId="job-1" fetchImpl={fetchImpl} />);
    await ouvrirFormulaire();
    await userEvent.selectOptions(screen.getByLabelText(/Motif/i), "Spam ou contenu trompeur");
    await userEvent.click(screen.getByRole("button", { name: /Envoyer le signalement/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Trop de signalements/i);
    // Le formulaire reste ouvert pour réessayer plus tard.
    expect(screen.getByTestId("signaler-panel")).toBeInTheDocument();
  });

  it("gère une erreur réseau sans planter", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    render(<SignalerButton contenuType="DOUBLAGE" contenuId="job-1" fetchImpl={fetchImpl} />);
    await ouvrirFormulaire();
    await userEvent.selectOptions(screen.getByLabelText(/Motif/i), "Autre");
    await userEvent.click(screen.getByRole("button", { name: /Envoyer le signalement/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/connexion/i);
  });
});
