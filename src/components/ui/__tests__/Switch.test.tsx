import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "../Switch";

describe("Switch (ST 11.1)", () => {
  it("expose role=switch et aria-checked", () => {
    render(<Switch label="Mode scène" checked />);
    expect(screen.getByRole("switch", { name: "Mode scène" })).toBeChecked();
  });

  it("bascule via onChange au clic", async () => {
    const onChange = vi.fn();
    render(<Switch label="Mode scène" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("est actionnable au clavier", async () => {
    const onChange = vi.fn();
    render(<Switch label="Mode scène" checked onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("n'appelle pas onChange quand disabled", async () => {
    const onChange = vi.fn();
    render(<Switch label="Mode scène" disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
