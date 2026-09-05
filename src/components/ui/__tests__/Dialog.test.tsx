import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "../Dialog";

describe("Dialog (ST 11.1)", () => {
  it("ne rend rien quand open est faux", () => {
    render(
      <Dialog open={false} title="Résultat">
        contenu
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("est nommé par son titre et modal", () => {
    render(<Dialog title="Résultat">contenu</Dialog>);
    expect(screen.getByRole("dialog", { name: "Résultat" })).toHaveAttribute(
      "aria-modal",
      "true"
    );
  });

  it("ferme via le bouton Fermer et la touche Échap", async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Résultat" onClose={onClose}>
        contenu
      </Dialog>
    );
    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("rend les actions du footer", () => {
    render(
      <Dialog title="Résultat" footer={<button>Télécharger</button>}>
        contenu
      </Dialog>
    );
    expect(screen.getByRole("button", { name: "Télécharger" })).toBeInTheDocument();
  });
});
