import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "../Checkbox";

describe("Checkbox (ST 11.1)", () => {
  it("rend une vraie case à cocher nommée par son label", () => {
    render(<Checkbox label="J'accepte" />);
    expect(screen.getByRole("checkbox", { name: "J'accepte" })).not.toBeChecked();
  });

  it("notifie onChange avec l'état suivant au clic", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="J'accepte" onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("est cochable au clavier (barre d'espace)", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="J'accepte" onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflète checked et associe le hint via aria-describedby", () => {
    render(<Checkbox label="Droits" hint="Usage non commercial" checked />);
    const box = screen.getByRole("checkbox", { name: "Droits" });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription("Usage non commercial");
  });

  it("ne notifie pas onChange quand disabled", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="J'accepte" disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
