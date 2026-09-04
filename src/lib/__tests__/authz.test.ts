import { describe, expect, it } from "vitest";
import {
  aAuMoinsLeRole,
  estRoleConnu,
  peutModerer,
  RoleInsuffisantError,
} from "../authz";

// ST 7.2, Definition of Done technique : « Tests unitaires sur … le contrôle
// de rôle ».

describe("estRoleConnu", () => {
  it("reconnaît les trois rôles", () => {
    expect(estRoleConnu("UTILISATEUR")).toBe(true);
    expect(estRoleConnu("MODERATEUR")).toBe(true);
    expect(estRoleConnu("ADMIN")).toBe(true);
  });

  it("rejette une valeur inconnue ou non-string", () => {
    expect(estRoleConnu("SUPERADMIN")).toBe(false);
    expect(estRoleConnu("")).toBe(false);
    expect(estRoleConnu(null)).toBe(false);
    expect(estRoleConnu(2)).toBe(false);
  });
});

describe("aAuMoinsLeRole", () => {
  it("applique la hiérarchie UTILISATEUR < MODERATEUR < ADMIN", () => {
    expect(aAuMoinsLeRole("ADMIN", "MODERATEUR")).toBe(true);
    expect(aAuMoinsLeRole("MODERATEUR", "MODERATEUR")).toBe(true);
    expect(aAuMoinsLeRole("UTILISATEUR", "MODERATEUR")).toBe(false);
    expect(aAuMoinsLeRole("MODERATEUR", "ADMIN")).toBe(false);
  });

  it("traite un rôle inconnu / absent comme le plus faible (pas d'élévation par défaut)", () => {
    expect(aAuMoinsLeRole(undefined, "MODERATEUR")).toBe(false);
    expect(aAuMoinsLeRole(null, "UTILISATEUR")).toBe(false);
    expect(aAuMoinsLeRole("UTILISATEUR", "UTILISATEUR")).toBe(true);
    expect(aAuMoinsLeRole("bidon", "MODERATEUR")).toBe(false);
  });
});

describe("peutModerer", () => {
  it("est vrai pour MODERATEUR et ADMIN uniquement", () => {
    expect(peutModerer("MODERATEUR")).toBe(true);
    expect(peutModerer("ADMIN")).toBe(true);
    expect(peutModerer("UTILISATEUR")).toBe(false);
    expect(peutModerer(undefined)).toBe(false);
  });
});

describe("RoleInsuffisantError", () => {
  it("porte le rôle requis", () => {
    const err = new RoleInsuffisantError("MODERATEUR");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RoleInsuffisantError");
    expect(err.roleRequis).toBe("MODERATEUR");
  });
});
