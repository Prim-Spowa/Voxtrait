import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, type TabItem } from "../Tabs";

const items: TabItem[] = [
  { value: "a", label: "Favoris", count: 3 },
  { value: "b", label: "Historique", count: 12 },
  { value: "c", label: "Réglages" },
];

describe("Tabs (ST 11.1)", () => {
  it("marque l'onglet actif via aria-selected et le sort du roving tabindex", () => {
    render(<Tabs items={items} value="b" />);
    expect(screen.getByRole("tab", { name: /Historique/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: /Favoris/ })).toHaveAttribute("tabindex", "-1");
  });

  it("notifie onChange au clic", async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="a" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: /Réglages/ }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("navigue à la flèche droite avec bouclage", async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="c" onChange={onChange} />);
    screen.getByRole("tab", { name: /Réglages/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("affiche le compteur quand il est fourni", () => {
    render(<Tabs items={items} value="a" />);
    expect(screen.getByRole("tab", { name: /Favoris/ })).toHaveTextContent("3");
  });
});
