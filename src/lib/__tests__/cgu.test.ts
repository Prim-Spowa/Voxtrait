import { describe, expect, it } from "vitest";
import {
  aAccepteCguActuelles,
  CGU_SECTIONS,
  CGU_VERSION,
  MESSAGE_IMPORT_CGU_REQUISES,
  peutImporter,
  raisonBlocageImport,
} from "../cgu";

// ST 4.3 — « Acceptation des CGU (fan-usage) ».
// DoD : « Tests unitaires sur le blocage d'import sans acceptation ».

describe("aAccepteCguActuelles", () => {
  it("est faux quand aucune acceptation n'est enregistrée", () => {
    expect(aAccepteCguActuelles(null)).toBe(false);
    expect(aAccepteCguActuelles(undefined)).toBe(false);
    expect(
      aAccepteCguActuelles({ cguAccepteesLe: null, cguVersionAcceptee: null })
    ).toBe(false);
  });

  it("est vrai quand horodatage + version courante sont présents", () => {
    expect(
      aAccepteCguActuelles({
        cguAccepteesLe: new Date(),
        cguVersionAcceptee: CGU_VERSION,
      })
    ).toBe(true);
    // Accepte aussi une date ISO (forme publique `UtilisateurPublic`).
    expect(
      aAccepteCguActuelles({
        cguAccepteesLe: "2026-08-28T10:00:00.000Z",
        cguVersionAcceptee: CGU_VERSION,
      })
    ).toBe(true);
  });

  it("redemande l'acceptation quand la version acceptée est obsolète", () => {
    expect(
      aAccepteCguActuelles({
        cguAccepteesLe: new Date(),
        cguVersionAcceptee: "2020-01-01",
      })
    ).toBe(false);
  });

  it("exige les DEUX champs (un horodatage sans version ne suffit pas)", () => {
    expect(
      aAccepteCguActuelles({ cguAccepteesLe: new Date(), cguVersionAcceptee: null })
    ).toBe(false);
    expect(
      aAccepteCguActuelles({ cguAccepteesLe: null, cguVersionAcceptee: CGU_VERSION })
    ).toBe(false);
  });
});

describe("peutImporter / raisonBlocageImport (blocage d'import — ST 4.3 → ST 5.1)", () => {
  const acceptant = { cguAccepteesLe: new Date(), cguVersionAcceptee: CGU_VERSION };
  const nonAcceptant = { cguAccepteesLe: null, cguVersionAcceptee: null };
  const versionObsolete = { cguAccepteesLe: new Date(), cguVersionAcceptee: "2019-05-01" };

  it("bloque l'import quand les CGU ne sont pas acceptées", () => {
    expect(peutImporter(nonAcceptant)).toBe(false);
    expect(raisonBlocageImport(nonAcceptant)).toBe(MESSAGE_IMPORT_CGU_REQUISES);
  });

  it("bloque l'import quand seule une version obsolète a été acceptée", () => {
    expect(peutImporter(versionObsolete)).toBe(false);
    expect(raisonBlocageImport(versionObsolete)).toBe(MESSAGE_IMPORT_CGU_REQUISES);
  });

  it("bloque l'import pour un utilisateur absent (null/undefined)", () => {
    expect(peutImporter(null)).toBe(false);
    expect(peutImporter(undefined)).toBe(false);
    expect(raisonBlocageImport(null)).toBe(MESSAGE_IMPORT_CGU_REQUISES);
  });

  it("autorise l'import quand la version courante est acceptée", () => {
    expect(peutImporter(acceptant)).toBe(true);
    expect(raisonBlocageImport(acceptant)).toBeNull();
  });
});

describe("contenu des CGU", () => {
  it("expose au moins une section avec un titre et un paragraphe", () => {
    expect(CGU_SECTIONS.length).toBeGreaterThan(0);
    for (const section of CGU_SECTIONS) {
      expect(section.titre.trim().length).toBeGreaterThan(0);
      expect(section.paragraphes.length).toBeGreaterThan(0);
    }
  });

  it("mentionne la version courante dans le texte (traçabilité)", () => {
    const texteComplet = CGU_SECTIONS.flatMap((s) => s.paragraphes).join(" ");
    expect(texteComplet).toContain(CGU_VERSION);
  });
});
