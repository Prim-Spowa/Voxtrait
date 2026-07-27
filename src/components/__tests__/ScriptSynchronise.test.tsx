import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScriptSynchronise } from "../ScriptSynchronise";
import type { ScriptLigneDTO } from "@/types/script";

// Tests de composant du script synchronisé (ST 1.3, Definition of Done
// "Tests unitaires sur la logique de surbrillance ; tests avec script vide").
//
// Comme pour VideoPlayer (ST 1.2) et BibliothequeListing (ST 1.1), les
// assertions portent sur le contenu/rôles accessibles rendus, pas sur les
// styles inline.

const LIGNES: ScriptLigneDTO[] = [
  { id: "l1", texte: "Tu ne passeras pas ce pont.", timestampDebut: 0, timestampFin: 3.2 },
  { id: "l2", texte: "Alors pousse-moi.", timestampDebut: 3.2, timestampFin: 5.4 },
  // Silence volontaire entre 5.4 et 5.9.
  { id: "l3", texte: "Tu regretteras d'avoir dit ça.", timestampDebut: 5.9, timestampFin: 8.9 },
];

describe("ScriptSynchronise — cas « pas de script disponible »", () => {
  it("affiche un message informatif (pas une erreur bloquante) quand `lignes` est vide", () => {
    render(<ScriptSynchronise lignes={[]} time={0} />);

    const message = screen.getByRole("status");
    expect(message).toHaveTextContent(/aucun script n'est disponible/i);
    // US 1.3, critère d'acceptation : "pas d'erreur bloquante" — donc pas de
    // role="alert".
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ScriptSynchronise — surbrillance dynamique", () => {
  it("met en évidence la réplique correspondant à l'instant courant", () => {
    render(<ScriptSynchronise lignes={LIGNES} time={1} />);
    expect(screen.getByTestId("script-synchronise-ligne-active")).toHaveTextContent(
      "Tu ne passeras pas ce pont."
    );
  });

  it("affiche la réplique suivante en retrait", () => {
    render(<ScriptSynchronise lignes={LIGNES} time={1} />);
    expect(screen.getByTestId("script-synchronise")).toHaveTextContent("Alors pousse-moi.");
  });

  it("change de réplique active quand `time` avance (ré-render avec une nouvelle prop)", () => {
    const { rerender } = render(<ScriptSynchronise lignes={LIGNES} time={1} />);
    expect(screen.getByTestId("script-synchronise-ligne-active")).toHaveTextContent(
      "Tu ne passeras pas ce pont."
    );

    rerender(<ScriptSynchronise lignes={LIGNES} time={4} />);
    expect(screen.getByTestId("script-synchronise-ligne-active")).toHaveTextContent(
      "Alors pousse-moi."
    );
  });

  it("n'affiche aucune ligne en surbrillance avant la première réplique", () => {
    render(<ScriptSynchronise lignes={LIGNES} time={-1} />);
    expect(screen.queryByTestId("script-synchronise-ligne-active")).not.toBeInTheDocument();
  });

  it("n'affiche aucune ligne en surbrillance pendant un silence entre deux répliques", () => {
    render(<ScriptSynchronise lignes={LIGNES} time={5.6} />);
    expect(screen.queryByTestId("script-synchronise-ligne-active")).not.toBeInTheDocument();
  });

  it("n'affiche aucune ligne en surbrillance après la dernière réplique", () => {
    render(<ScriptSynchronise lignes={LIGNES} time={100} />);
    expect(screen.queryByTestId("script-synchronise-ligne-active")).not.toBeInTheDocument();
  });

  it("ne casse pas s'il n'y a pas de réplique suivante (dernière ligne active)", () => {
    render(<ScriptSynchronise lignes={LIGNES} time={6} />);
    expect(screen.getByTestId("script-synchronise-ligne-active")).toHaveTextContent(
      "Tu regretteras d'avoir dit ça."
    );
  });
});
