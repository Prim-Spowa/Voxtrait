import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toast } from "../Toast";

describe("Toast (ST 11.1)", () => {
  it("annonce le message via role=status", () => {
    render(<Toast tone="success">Lien copié</Toast>);
    expect(screen.getByRole("status")).toHaveTextContent("Lien copié");
  });

  it("affiche le bouton Fermer seulement si onClose est fourni", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Toast tone="info">Info</Toast>);
    expect(screen.queryByRole("button", { name: "Fermer" })).not.toBeInTheDocument();

    rerender(
      <Toast tone="info" onClose={onClose}>
        Info
      </Toast>
    );
    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("retombe sur le ton info pour une valeur inconnue", () => {
    // @ts-expect-error test de robustesse sur une valeur hors contrat
    render(<Toast tone="bogus">X</Toast>);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
