import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegisterForm } from "../RegisterForm";

// ST 4.1 — formulaire d'inscription (DoD : « Formulaire frontend avec
// messages d'erreur explicites »). `fetch` injecté.

const VALID_EMAIL = "alice@example.com";
const VALID_PASSWORD = "Corr3ct-horse-battery";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<{
    email: string;
    password: string;
    confirm: string;
    acceptCgu: boolean;
    nom: string;
    prenom: string;
    age: string;
  }> = {}
) {
  const email = overrides.email ?? VALID_EMAIL;
  const password = overrides.password ?? VALID_PASSWORD;
  const confirm = overrides.confirm ?? password;
  await user.type(screen.getByLabelText("Adresse e-mail"), email);
  // Mise à jour ST 4.1 — champs profil, requis pour que la soumission passe
  // la validation locale dans les tests qui n'en font pas l'objet.
  if (overrides.nom !== "") {
    await user.type(screen.getByLabelText("Nom"), overrides.nom ?? "Martin");
  }
  if (overrides.prenom !== "") {
    await user.type(screen.getByLabelText("Prénom"), overrides.prenom ?? "Alice");
  }
  if (overrides.age !== "") {
    await user.type(screen.getByLabelText("Âge"), overrides.age ?? "28");
  }
  await user.type(screen.getByLabelText("Mot de passe"), password);
  await user.type(screen.getByLabelText("Confirmer le mot de passe"), confirm);
  // ST 4.3 — case d'acceptation des CGU (cochée par défaut dans les tests).
  if (overrides.acceptCgu !== false) {
    await user.click(screen.getByRole("checkbox", { name: /conditions générales/i }));
  }
}

describe("RegisterForm", () => {
  it("valide localement avant tout appel réseau", async () => {
    const fetchImpl = vi.fn();
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user, { email: "pas-un-email" });
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    expect(await screen.findByText(/n'est pas valide/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signale une confirmation de mot de passe divergente", async () => {
    const fetchImpl = vi.fn();
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user, { confirm: "autre-chose-entierement" });
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("poste vers /api/auth/register et affiche l'écran de succès", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        utilisateur: { id: "u1", email: VALID_EMAIL, statut: "ACTIF", dateCreation: "2026-08-28T00:00:00.000Z" },
      })
    );
    const onRegistered = vi.fn();
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} onRegistered={onRegistered} />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText(/Compte créé/i)).toBeInTheDocument();
    expect(onRegistered).toHaveBeenCalledWith(expect.objectContaining({ email: VALID_EMAIL }));
  });

  it("rattache un 409 au champ e-mail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, { error: "Un compte existe déjà avec cette adresse e-mail." })
    );
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    expect(await screen.findByText(/existe déjà/i)).toBeInTheDocument();
  });

  it("affiche un message global sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(429, { error: "Trop de tentatives d'inscription. Réessayez dans quelques minutes." })
    );
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Trop de tentatives/i);
  });

  it("bloque la soumission tant que les CGU ne sont pas acceptées (ST 4.3)", async () => {
    const fetchImpl = vi.fn();
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user, { acceptCgu: false });
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    expect(await screen.findByText(/accepter les conditions générales/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("transmet accepteCgu au serveur quand la case est cochée (ST 4.3)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        utilisateur: {
          id: "u1",
          email: VALID_EMAIL,
          statut: "ACTIF",
          dateCreation: "2026-08-28T00:00:00.000Z",
          cguAccepteesLe: "2026-08-28T00:00:00.000Z",
          cguVersionAcceptee: "2026-08-28",
        },
      })
    );
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.accepteCgu).toBe(true);
  });

  it("bloque la soumission si nom, prénom ou âge sont manquants (mise à jour ST 4.1)", async () => {
    const fetchImpl = vi.fn();
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user, { nom: "" });
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    expect(await screen.findByText(/Le nom est requis/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("transmet nom, prénom et âge (nombre) au serveur (mise à jour ST 4.1)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        utilisateur: { id: "u1", email: VALID_EMAIL, statut: "ACTIF", dateCreation: "2026-08-28T00:00:00.000Z" },
      })
    );
    const user = userEvent.setup();
    render(<RegisterForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillForm(user, { nom: "Dupont", prenom: "Jean", age: "34" });
    await user.click(screen.getByRole("button", { name: /Créer mon compte/i }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ nom: "Dupont", prenom: "Jean", age: 34 });
  });

  it("lie un lien vers la page /cgu", () => {
    render(<RegisterForm fetchImpl={vi.fn() as unknown as typeof fetch} />);
    expect(screen.getByRole("link", { name: /Lire les CGU/i })).toHaveAttribute("href", "/cgu");
  });

  it("affiche l'information RGPD", () => {
    render(<RegisterForm fetchImpl={(vi.fn()) as unknown as typeof fetch} />);
    expect(screen.getByText(/conservés uniquement/i)).toBeInTheDocument();
  });
});
