import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "../Card";

describe("Card (ST 11.1)", () => {
  it("rend un div par défaut avec le contenu", () => {
    const { container } = render(<Card>contenu</Card>);
    expect(container.firstChild?.nodeName).toBe("DIV");
    expect(screen.getByText("contenu")).toBeInTheDocument();
  });

  it("rend l'élément demandé via `as` et relaie data-testid", () => {
    render(
      <ul>
        <Card as="li" data-testid="ligne">
          x
        </Card>
      </ul>
    );
    const el = screen.getByTestId("ligne");
    expect(el.nodeName).toBe("LI");
  });

  it("applique une ombre dure seulement en variante raised", () => {
    const { rerender, container } = render(<Card variant="flat">x</Card>);
    expect((container.firstChild as HTMLElement).style.boxShadow).toBe("none");
    rerender(<Card variant="raised">x</Card>);
    expect((container.firstChild as HTMLElement).style.boxShadow).toBe("var(--shadow-hard)");
  });

  it("inverse le fond en variante inverse", () => {
    const { container } = render(<Card variant="inverse">x</Card>);
    expect((container.firstChild as HTMLElement).style.background).toBe("var(--surface-inverse)");
  });

  it("accepte un padding personnalisé et fusionne le style", () => {
    const { container } = render(
      <Card padding="var(--space-8)" style={{ display: "flex" }}>
        x
      </Card>
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.padding).toBe("var(--space-8)");
    expect(el.style.display).toBe("flex");
  });
});
