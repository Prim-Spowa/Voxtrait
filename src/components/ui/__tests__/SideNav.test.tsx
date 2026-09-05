import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SideNav, type SideNavGroup } from "../SideNav";

const groups: SideNavGroup[] = [
  { label: "Origine", items: [{ label: "France", count: 214 }, { label: "Japon", count: 96 }] },
  { label: "Format", items: [{ label: "Film" }, { label: "Série" }] },
];

describe("SideNav (ST 11.1)", () => {
  it("expose une région de navigation étiquetée et un titre par groupe", () => {
    render(<SideNav groups={groups} />);
    expect(screen.getByRole("navigation", { name: "Filtres du catalogue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Origine" })).toBeInTheDocument();
  });

  it("marque les items sélectionnés via aria-pressed et affiche les compteurs", () => {
    render(<SideNav groups={groups} selected={["Japon"]} onToggle={vi.fn()} />);
    const japon = screen.getByRole("button", { name: /japon/i });
    expect(japon).toHaveAttribute("aria-pressed", "true");
    expect(japon).toHaveTextContent("96");
    expect(screen.getByRole("button", { name: /france/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("notifie onToggle avec le libellé et son groupe au clic", async () => {
    const onToggle = vi.fn();
    render(<SideNav groups={groups} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Film" }));
    expect(onToggle).toHaveBeenCalledWith(
      "Film",
      expect.objectContaining({ label: "Format" })
    );
  });

  it("rend le contenu d'en-tête au-dessus des groupes", () => {
    render(
      <SideNav
        groups={groups}
        header={<input type="search" aria-label="Rechercher" />}
      />
    );
    expect(screen.getByRole("searchbox", { name: "Rechercher" })).toBeInTheDocument();
  });

  it("accepte une étiquette accessible personnalisée", () => {
    render(<SideNav groups={groups} aria-label="Filtrer la bibliothèque" />);
    expect(
      within(screen.getByRole("navigation", { name: "Filtrer la bibliothèque" })).getByRole(
        "heading",
        { name: "Format" }
      )
    ).toBeInTheDocument();
  });
});
