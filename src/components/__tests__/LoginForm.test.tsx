import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "../LoginForm";

// ST 4.2 — formulaire de connexion. `fetch` injecté.

const VALID_EMAIL = "alice@example.com";
const VALID_PASSWORD = "Corr3ct-horse-battery";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<{ email: string; password: string }> = {}
) {
  await user.type(screen.getByLabelText("Adresse e-mail"), overrides.email ?? VALID_EMAIL);
  await user.type(screen.getByLabelText("Mot de passe"), overrides.password ?? VALID_PASSWORD);
  await user.click(screen.getByRole("button", { name: /Me connecter/i }));
}

describe("LoginForm", () => {
  it("exige les deux champs avant tout appel réseau", async () => {
    const fetchImpl = vi.fn();
    const user = userEvent.setup();
    render(<LoginForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await user.click(screen.getByRole("button", { name: /Me connecter/i }));

    expect(await screen.findByText(/adresse e-mail est requise/i)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("poste vers /api/auth/login et notifie le parent sur 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        utilisateur: { id: "u1", email: VALID_EMAIL, statut: "ACTIF", dateCreation: "2026-08-28T00:00:00.000Z" },
      })
    );
    const onLoggedIn = vi.fn();
    const user = userEvent.setup();
    render(<LoginForm fetchImpl={fetchImpl as unknown as typeof fetch} onLoggedIn={onLoggedIn} />);

    await fillAndSubmit(user);

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }))
    );
    expect(onLoggedIn).toHaveBeenCalledWith(expect.objectContaining({ email: VALID_EMAIL }));
  });

  it("affiche un message générique sur 401 (sans désigner le champ fautif)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "Adresse e-mail ou mot de passe incorrect." }));
    const user = userEvent.setup();
    render(<LoginForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillAndSubmit(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/incorrect/i);
    // Le message n'est rattaché à aucun champ précis.
    expect(screen.getByLabelText("Adresse e-mail")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("affiche un message global sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(429, { error: "Trop de tentatives de connexion. Réessayez dans quelques minutes." })
    );
    const user = userEvent.setup();
    render(<LoginForm fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Trop de tentatives/i);
  });

  it("propose un lien vers l'inscription", () => {
    render(<LoginForm fetchImpl={vi.fn() as unknown as typeof fetch} />);
    expect(screen.getByRole("link", { name: /Créer un compte/i })).toHaveAttribute("href", "/inscription");
  });
});
