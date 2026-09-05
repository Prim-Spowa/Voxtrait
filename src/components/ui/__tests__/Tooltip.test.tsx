import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip } from "../Tooltip";

describe("Tooltip (ST 11.1)", () => {
  it("garde l'infobulle masquée au repos mais présente pour aria-describedby", () => {
    render(
      <Tooltip label="Copier le lien">
        <button>Partager</button>
      </Tooltip>
    );
    expect(screen.getByRole("tooltip", { hidden: true })).not.toBeVisible();
  });

  it("révèle l'infobulle au survol", async () => {
    render(
      <Tooltip label="Copier le lien">
        <button>Partager</button>
      </Tooltip>
    );
    await userEvent.hover(screen.getByText("Partager"));
    expect(screen.getByRole("tooltip")).toBeVisible();
  });

  it("révèle l'infobulle au focus clavier", async () => {
    render(
      <Tooltip label="Copier le lien">
        <button>Partager</button>
      </Tooltip>
    );
    await userEvent.tab();
    expect(screen.getByRole("tooltip")).toBeVisible();
  });
});
