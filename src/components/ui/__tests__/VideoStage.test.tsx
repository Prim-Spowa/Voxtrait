import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoStage } from "../VideoStage";

describe("VideoStage (ST 11.1)", () => {
  it("affiche le timecode courant et la durée en mono", () => {
    render(<VideoStage time={65} duration={130} />);
    expect(screen.getByText("01:05 / 02:10")).toBeInTheDocument();
  });

  it("bascule lecture/pause via le libellé du bouton", async () => {
    const onTogglePlay = vi.fn();
    const { rerender } = render(<VideoStage onTogglePlay={onTogglePlay} />);
    await userEvent.click(screen.getByRole("button", { name: "Lire" }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    rerender(<VideoStage playing onTogglePlay={onTogglePlay} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("expose la barre de progression comme slider avec seek clavier", async () => {
    const onSeek = vi.fn();
    render(<VideoStage time={10} duration={100} onSeek={onSeek} />);
    const slider = screen.getByRole("slider", { name: "Position de lecture" });
    expect(slider).toHaveAttribute("aria-valuenow", "10");
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSeek).toHaveBeenCalledWith(15);
  });

  it("montre le badge REC quand recording est vrai", () => {
    render(<VideoStage recording />);
    expect(screen.getByText("rec")).toBeInTheDocument();
  });
});
