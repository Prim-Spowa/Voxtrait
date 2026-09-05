import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressBar } from "../ProgressBar";

describe("ProgressBar (ST 11.1)", () => {
  it("expose les attributs ARIA de progression", () => {
    render(<ProgressBar value={30} max={120} aria-label="Traitement" />);
    const bar = screen.getByRole("progressbar", { name: "Traitement" });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemax", "120");
  });

  it("borne le pourcentage affiché entre 0 et 100", () => {
    render(<ProgressBar value={999} label="Envoi" />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("utilise le label comme nom accessible par défaut", () => {
    render(<ProgressBar value={10} label="Compression" />);
    expect(screen.getByRole("progressbar", { name: "Compression" })).toBeInTheDocument();
  });
});
