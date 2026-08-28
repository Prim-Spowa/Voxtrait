import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogoutButton } from "../LogoutButton";

// ST 4.2 — bouton de déconnexion.

describe("LogoutButton", () => {
  it("poste vers /api/auth/logout puis redirige", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    const onRedirect = vi.fn();
    const user = userEvent.setup();
    render(
      <LogoutButton
        fetchImpl={fetchImpl as unknown as typeof fetch}
        onRedirect={onRedirect}
        redirectTo="/bibliotheque"
      />
    );

    await user.click(screen.getByRole("button", { name: /Se déconnecter/i }));

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }))
    );
    expect(onRedirect).toHaveBeenCalledWith("/bibliotheque");
  });

  it("redirige quand même si l'appel réseau échoue", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const onRedirect = vi.fn();
    const user = userEvent.setup();
    render(
      <LogoutButton fetchImpl={fetchImpl as unknown as typeof fetch} onRedirect={onRedirect} />
    );

    await user.click(screen.getByRole("button", { name: /Se déconnecter/i }));

    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith("/bibliotheque"));
  });
});
