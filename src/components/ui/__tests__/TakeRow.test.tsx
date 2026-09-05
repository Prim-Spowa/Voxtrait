import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TakeRow } from "../TakeRow";

const base = { index: 3, title: "Prise du soir", duration: "00:42", date: "12 sept." };

describe("TakeRow (ST 11.1)", () => {
  it("numérote la prise sur deux chiffres", () => {
    render(<TakeRow {...base} />);
    expect(screen.getByText("03")).toBeInTheDocument();
  });

  it("affiche le badge « privé » quand saved, « non sauvegardé » sinon", () => {
    const { rerender } = render(<TakeRow {...base} saved />);
    expect(screen.getByText("privé")).toBeInTheDocument();
    rerender(<TakeRow {...base} saved={false} />);
    expect(screen.getByText("non sauvegardé")).toBeInTheDocument();
  });

  it("expose les quatre actions et les câble", async () => {
    const onPlay = vi.fn();
    const onDownload = vi.fn();
    const onShare = vi.fn();
    const onDelete = vi.fn();
    render(
      <TakeRow
        {...base}
        onPlay={onPlay}
        onDownload={onDownload}
        onShare={onShare}
        onDelete={onDelete}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Écouter la prise" }));
    await userEvent.click(screen.getByRole("button", { name: "Télécharger" }));
    await userEvent.click(screen.getByRole("button", { name: "Partager" }));
    await userEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
