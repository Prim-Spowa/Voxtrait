import { describe, expect, it } from "vitest";
import {
  aCertificationDroitsActuelle,
  CERTIFICATION_DROITS_CASE_LABEL,
  CERTIFICATION_DROITS_REQUISE,
  CERTIFICATION_DROITS_TEXTE,
  CERTIFICATION_DROITS_VERSION,
  erreurCertificationDroits,
  estCertificationDroitsCochee,
} from "../certificationDroits";

// ST 5.2 — « Certification des droits à l'import ».
// DoD : « Test unitaire sur le blocage sans certification ».

describe("estCertificationDroitsCochee", () => {
  it("n'est vrai que pour le booléen true (acte positif explicite)", () => {
    expect(estCertificationDroitsCochee(true)).toBe(true);
  });

  it("est faux pour toute autre valeur", () => {
    for (const valeur of [false, undefined, null, 0, 1, "true", "on", "", {}]) {
      expect(estCertificationDroitsCochee(valeur)).toBe(false);
    }
  });
});

describe("erreurCertificationDroits (blocage de soumission)", () => {
  it("renvoie null quand la case est cochée", () => {
    expect(erreurCertificationDroits(true)).toBeNull();
  });

  it("renvoie le message de blocage quand la case n'est pas cochée", () => {
    expect(erreurCertificationDroits(false)).toBe(CERTIFICATION_DROITS_REQUISE);
    expect(erreurCertificationDroits(undefined)).toBe(CERTIFICATION_DROITS_REQUISE);
  });
});

describe("aCertificationDroitsActuelle", () => {
  it("est faux sans trace de certification", () => {
    expect(aCertificationDroitsActuelle(null)).toBe(false);
    expect(aCertificationDroitsActuelle(undefined)).toBe(false);
    expect(
      aCertificationDroitsActuelle({
        certificationDroitsLe: null,
        certificationDroitsVersion: null,
      })
    ).toBe(false);
  });

  it("est vrai avec horodatage + version courante (Date ou ISO)", () => {
    expect(
      aCertificationDroitsActuelle({
        certificationDroitsLe: new Date(),
        certificationDroitsVersion: CERTIFICATION_DROITS_VERSION,
      })
    ).toBe(true);
    expect(
      aCertificationDroitsActuelle({
        certificationDroitsLe: "2026-09-01T08:00:00.000Z",
        certificationDroitsVersion: CERTIFICATION_DROITS_VERSION,
      })
    ).toBe(true);
  });

  it("est faux si la version certifiée est obsolète", () => {
    expect(
      aCertificationDroitsActuelle({
        certificationDroitsLe: new Date(),
        certificationDroitsVersion: "2000-01-01",
      })
    ).toBe(false);
  });
});

describe("contenu du texte", () => {
  it("expose un libellé de case et une déclaration non vides", () => {
    expect(CERTIFICATION_DROITS_CASE_LABEL.length).toBeGreaterThan(10);
    expect(CERTIFICATION_DROITS_TEXTE).toMatch(/certifie/i);
    expect(CERTIFICATION_DROITS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
