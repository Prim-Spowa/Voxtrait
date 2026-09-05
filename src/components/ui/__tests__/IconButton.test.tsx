import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IconButton } from "../IconButton";

describe("IconButton (ST 11.1)", () => {
  it("expose le libellé via aria-label et title", () => {
    render(<IconButton icon="x" label="Fermer" />);
    const btn = screen.getByRole("button", { name: "Fermer" });
    expect(btn).toHaveAttribute("title", "Fermer");
  });

  it("déclenche onClick au clic", async () => {
    const onClick = vi.fn();
    render(<IconButton icon="play" label="Lire" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Lire" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ne déclenche pas onClick quand disabled", async () => {
    const onClick = vi.fn();
    render(<IconButton icon="play" label="Lire" disabled onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Lire" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("relaie aria-pressed pour un usage en bascule", () => {
    render(<IconButton icon="mic" label="Micro" active aria-pressed />);
    expect(screen.getByRole("button", { name: "Micro" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
