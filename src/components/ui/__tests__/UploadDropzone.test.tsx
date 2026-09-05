import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadDropzone } from "../UploadDropzone";

describe("UploadDropzone (ST 11.1)", () => {
  it("annonce la contrainte de durée et la recompression dès l'état vide", () => {
    render(<UploadDropzone />);
    expect(screen.getByText(/5 minutes maximum/)).toBeInTheDocument();
    expect(screen.getByText(/recompressé à l'envoi/)).toBeInTheDocument();
  });

  it("déclenche onPick via le bouton Choisir un fichier", async () => {
    const onPick = vi.fn();
    render(<UploadDropzone onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /Choisir un fichier/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("affiche le message de refus et le titre « Import refusé »", () => {
    render(<UploadDropzone error="Fichier trop long (7 min)" />);
    expect(screen.getByRole("heading", { name: "Import refusé" })).toBeInTheDocument();
    expect(screen.getByText("Fichier trop long (7 min)")).toBeInTheDocument();
  });

  it("montre la progression de compression en état uploading", () => {
    render(<UploadDropzone state="uploading" filename="scene.mp4" progress={40} />);
    expect(screen.getByText("scene.mp4")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Compression" })).toHaveAttribute(
      "aria-valuenow",
      "40"
    );
  });
});
