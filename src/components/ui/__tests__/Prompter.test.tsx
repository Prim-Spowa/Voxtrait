import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Prompter, type PrompterLine } from "../Prompter";

const lines: PrompterLine[] = [
  { character: "NOVA", text: "on decolle maintenant", start: 0, end: 4 },
  { character: "ORION", text: "accroche toi", start: 4, end: 7 },
];

describe("Prompter (ST 11.1)", () => {
  it("ne rend rien sans réplique", () => {
    const { container } = render(<Prompter lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche la réplique courante et la suivante", () => {
    render(<Prompter lines={lines} time={1} />);
    expect(screen.getByText("NOVA")).toBeInTheDocument();
    expect(screen.getByText("accroche toi")).toBeInTheDocument();
  });

  it("découpe la réplique courante en mots (remplissage karaoké)", () => {
    render(<Prompter lines={lines} time={2} />);
    // « on decolle maintenant » -> le mot « decolle » est un span distinct
    expect(screen.getByText("decolle")).toBeInTheDocument();
  });

  it("retombe sur la première réplique avant le début", () => {
    render(<Prompter lines={lines} time={-5} />);
    expect(screen.getByText("NOVA")).toBeInTheDocument();
  });
});
