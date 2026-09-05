import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../Avatar";

describe("Avatar (ST 11.1)", () => {
  it("dérive jusqu'à deux initiales du nom", () => {
    render(<Avatar name="Alice Dupont Martin" />);
    expect(screen.getByText("AD")).toBeInTheDocument();
  });

  it("n'affiche pas d'initiales quand une image est fournie", () => {
    const { container } = render(<Avatar name="Alice" src="https://x/a.png" />);
    expect(container.textContent).toBe("");
  });

  it("porte le nom en infobulle", () => {
    const { container } = render(<Avatar name="Alice Dupont" />);
    expect(container.firstChild).toHaveAttribute("title", "Alice Dupont");
  });

  it("peut être masqué aux lecteurs d'écran", () => {
    const { container } = render(<Avatar name="Alice" aria-hidden />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
