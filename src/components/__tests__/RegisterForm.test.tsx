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

async function fillForm(user: ReturnType<typeof userEvent.setup>, overrides: Partial<{ email: string; password: string; confirm: string }> = {}) {
  const email = overrides.email ?? VALID_EMAIL;
  const password = overrides.password ?? VALID_PASSWORD;
  const confirm = overrides.confirm ?? password;
  await user.type(screen.getByLabelText("Adresse e-mail"), email);
  await user.type(screen.getByLabelText("Mot de passe"), password);
  await user.type(screen.getByLabelText("Confirmer le mot de passe"), confirm);
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

  it("affiche l'information RGPD", () => {
    render(<RegisterForm fetchImpl={(vi.fn()) as unknown as typeof fetch} />);
    expect(screen.getByText(/conservés uniquement/i)).toBeInTheDocument();
  });
});
