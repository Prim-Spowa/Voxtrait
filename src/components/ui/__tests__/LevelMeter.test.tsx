import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LevelMeter } from "../LevelMeter";

describe("LevelMeter (ST 11.1)", () => {
  it("est masqué aux lecteurs d'écran (indicateur purement visuel)", () => {
    const { container } = render(<LevelMeter />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("rend le nombre de barres demandé", () => {
    const { container } = render(<LevelMeter bars={12} />);
    expect(container.firstChild?.childNodes).toHaveLength(12);
  });

  it("anime les barres seulement quand active", () => {
    const { container, rerender } = render(<LevelMeter active={false} />);
    const first = container.querySelector("div > span") as HTMLElement;
    expect(first.style.animation).toBe("none");
    rerender(<LevelMeter active />);
    const animated = container.querySelector("div > span") as HTMLElement;
    expect(animated.style.animation).not.toBe("none");
  });
});
