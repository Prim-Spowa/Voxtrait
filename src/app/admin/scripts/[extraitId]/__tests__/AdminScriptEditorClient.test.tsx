import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminScriptEditorClient } from "../AdminScriptEditorClient";

// Tests de l'outil interne de saisie/import (ST 1.3, découpage en tâches,
// point 4). Même style de test que BibliothequeListing (ST 1.1) : fetch
// mocké, assertions sur le comportement/contenu accessible.

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("AdminScriptEditorClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("affiche le bandeau d'avertissement sur l'absence de contrôle d'accès", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ extraitId: "mock-001", lignes: [] })
    );

    render(<AdminScriptEditorClient extraitId="mock-001" />);

    expect(screen.getByText(/sans contrôle d'accès/i)).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("charge et affiche le script existant au montage", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        extraitId: "mock-001",
        lignes: [{ id: "l1", texte: "Déjà en base", timestampDebut: 0, timestampFin: 1 }],
      })
    );

    render(<AdminScriptEditorClient extraitId="mock-001" />);

    await waitFor(() => {
      expect(screen.getByTestId("script-existant-liste")).toHaveTextContent("Déjà en base");
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/extraits/mock-001/script",
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it("refuse d'ajouter une ligne invalide au formulaire (texte vide)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ extraitId: "mock-001", lignes: [] })
    );
    const user = userEvent.setup();

    render(<AdminScriptEditorClient extraitId="mock-001" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/début \(s\)/i), "0");
    await user.type(screen.getByLabelText(/fin \(s\)/i), "1");
    await user.click(screen.getByRole("button", { name: /ajouter à la liste d'attente/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/texte.*requis/i);
    expect(screen.queryByTestId("liste-attente")).not.toBeInTheDocument();
  });

  it("ajoute une ligne valide à la liste d'attente puis l'envoie", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ extraitId: "mock-001", lignes: [] })) // GET initial
      .mockResolvedValueOnce(jsonResponse({ extraitId: "mock-001", inserted: 1 }, true, 201)); // POST

    const user = userEvent.setup();
    render(<AdminScriptEditorClient extraitId="mock-001" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/texte de la réplique/i), "Bonjour");
    await user.type(screen.getByLabelText(/début \(s\)/i), "0");
    await user.type(screen.getByLabelText(/fin \(s\)/i), "1.5");
    await user.click(screen.getByRole("button", { name: /ajouter à la liste d'attente/i }));

    expect(screen.getByTestId("liste-attente")).toHaveTextContent("Bonjour");

    await user.click(screen.getByRole("button", { name: /envoyer 1 ligne/i }));

    await waitFor(() => {
      expect(screen.getByText(/1 ligne\(s\) importée\(s\) avec succès/i)).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenLastCalledWith(
      "/api/extraits/mock-001/script",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ lignes: [{ texte: "Bonjour", timestampDebut: 0, timestampFin: 1.5 }] }),
      })
    );
    // La liste d'attente est vidée après un envoi réussi.
    expect(screen.queryByTestId("liste-attente")).not.toBeInTheDocument();
  });

  it("affiche l'erreur serveur et conserve la liste d'attente si l'envoi échoue", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ extraitId: "mock-001", lignes: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: "Ligne 1 : texte requis." }, false, 400));

    const user = userEvent.setup();
    render(<AdminScriptEditorClient extraitId="mock-001" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/texte de la réplique/i), "Bonjour");
    await user.type(screen.getByLabelText(/début \(s\)/i), "0");
    await user.type(screen.getByLabelText(/fin \(s\)/i), "1.5");
    await user.click(screen.getByRole("button", { name: /ajouter à la liste d'attente/i }));
    await user.click(screen.getByRole("button", { name: /envoyer 1 ligne/i }));

    await waitFor(() => {
      expect(screen.getByText(/Ligne 1 : texte requis\./i)).toBeInTheDocument();
    });
    // Le lot en attente n'est vidé qu'après un succès confirmé.
    expect(screen.getByTestId("liste-attente")).toHaveTextContent("Bonjour");
  });

  it("rejette un import en masse dont le JSON est invalide", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ extraitId: "mock-001", lignes: [] })
    );
    const user = userEvent.setup();

    render(<AdminScriptEditorClient extraitId="mock-001" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/lignes au format json/i), "pas du json");
    await user.click(screen.getByRole("button", { name: /ajouter le lot à la liste d'attente/i }));

    expect(screen.getByText(/json invalide/i)).toBeInTheDocument();
  });

  it("ajoute un lot importé en masse à la liste d'attente", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ extraitId: "mock-001", lignes: [] })
    );
    const user = userEvent.setup();

    render(<AdminScriptEditorClient extraitId="mock-001" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    // `fireEvent.change` plutôt que `user.type` : le JSON contient des
    // accolades/crochets, interprétés par userEvent comme des raccourcis
    // clavier lors d'une saisie caractère par caractère.
    const payload = JSON.stringify([{ texte: "Ligne importée", timestampDebut: 0, timestampFin: 2 }]);
    fireEvent.change(screen.getByLabelText(/lignes au format json/i), {
      target: { value: payload },
    });
    await user.click(screen.getByRole("button", { name: /ajouter le lot à la liste d'attente/i }));

    expect(screen.getByTestId("liste-attente")).toHaveTextContent("Ligne importée");
  });
});
