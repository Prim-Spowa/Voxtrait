import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordBar } from "../RecordBar";

describe("RecordBar (ST 11.1)", () => {
  it("déclenche onRecord depuis l'état idle", async () => {
    const onRecord = vi.fn();
    render(<RecordBar state="idle" onRecord={onRecord} />);
    await userEvent.click(screen.getByRole("button", { name: "Lancer l'enregistrement" }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it("déclenche onStop pendant l'enregistrement", async () => {
    const onStop = vi.fn();
    render(<RecordBar state="recording" onStop={onStop} />);
    await userEvent.click(screen.getByRole("button", { name: "Arrêter l'enregistrement" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("affiche le décompte en état counting", () => {
    render(<RecordBar state="counting" countdown={2} />);
    expect(screen.getByText(/Ça tourne dans… 2/)).toBeInTheDocument();
  });

  it("propose Refaire et Valider la prise en état done", async () => {
    const onRetake = vi.fn();
    const onSave = vi.fn();
    render(<RecordBar state="done" onRetake={onRetake} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: /Refaire/ }));
    await userEvent.click(screen.getByRole("button", { name: /Valider la prise/ }));
    expect(onRetake).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("formate le chrono en mm:ss", () => {
    render(<RecordBar state="recording" elapsed={75} duration={120} />);
    expect(screen.getByText(/01:15/)).toBeInTheDocument();
  });
});
