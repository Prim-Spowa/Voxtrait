import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TopBar } from "../TopBar";

// ST 10.1 — lien « Importer » dans la navigation, réservé aux comptes connectés.

function fetchImplWith(utilisateur: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ utilisateur }),
  } as Response);
}

describe("TopBar — lien Importer (ST 10.1)", () => {
  it("n'affiche pas le lien Importer tant que la session est inconnue", () => {
    // `fetchImpl` volontairement non résolu : la requête est en vol.
    const fetchImpl = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<TopBar fetchImpl={fetchImpl as unknown as typeof fetch} />);

    expect(screen.queryByRole("button", { name: /Importer/i })).not.toBeInTheDocument();
  });

  it("masque le lien Importer pour un visiteur anonyme", async () => {
    const fetchImpl = fetchImplWith(null);
    render(<TopBar fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Se connecter/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: /Importer/i })).not.toBeInTheDocument();
  });

  it("affiche le lien Importer pour un compte connecté et redirige vers /import", async () => {
    const fetchImpl = fetchImplWith({
      id: "u1",
      email: "a@b.com",
      nom: "Dupont",
      prenom: "Alice",
    });
    render(<TopBar fetchImpl={fetchImpl as unknown as typeof fetch} />);

    const importer = await screen.findByRole("button", { name: /Importer/i });
    expect(importer).toBeInTheDocument();

    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });

    importer.click();
    expect(assign).toHaveBeenCalledWith("/import");
  });
});
