import { describe, expect, it } from "vitest";
import {
  assessPasswordStrength,
  collectRegistrationErrors,
  EMAIL_MAX_LENGTH,
  isRegistrationInputValid,
  isValidEmail,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
} from "../authClient";

// ST 4.1 — logique client-safe : normalisation e-mail, validation format
// e-mail + robustesse mot de passe (source de vérité partagée client/serveur).

describe("normalizeEmail", () => {
  it("retire les espaces et met en minuscules", () => {
    expect(normalizeEmail("  Alice.Martin@Example.COM ")).toBe("alice.martin@example.com");
  });
  it("gère une valeur vide", () => {
    expect(normalizeEmail("")).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepte une adresse ordinaire", () => {
    expect(isValidEmail("alice@example.com")).toBe(true);
    expect(isValidEmail("a.b-c+tag@sub.domain.fr")).toBe(true);
  });

  it("refuse les adresses manifestement invalides", () => {
    for (const bad of [
      "",
      "   ",
      "alice",
      "alice@",
      "@example.com",
      "alice@example",
      "alice@@example.com",
      "alice example@x.com",
      "alice@example..com",
      "alice@.example.com",
      "alice@example.com.",
    ]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("refuse une chaîne avec retour à la ligne (tentative d'injection d'en-tête)", () => {
    expect(isValidEmail("alice@example.com\nBcc: victim@x.com")).toBe(false);
    expect(isValidEmail("alice@example.com\r\nSubject: x")).toBe(false);
  });

  it("refuse une adresse trop longue", () => {
    const local = "a".repeat(EMAIL_MAX_LENGTH);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });
});

describe("assessPasswordStrength", () => {
  it("accepte un mot de passe long combinant plusieurs classes", () => {
    expect(assessPasswordStrength("Corr3ct-horse-battery")).toBeNull();
    expect(assessPasswordStrength("phrase de passe correcte 42")).toBeNull();
  });

  it("refuse un mot de passe trop court", () => {
    expect(assessPasswordStrength("Ab1cdef")).toMatch(new RegExp(String(PASSWORD_MIN_LENGTH)));
  });

  it("refuse un mot de passe trop long", () => {
    expect(assessPasswordStrength(`${"a".repeat(200)}B1`)).toMatch(/dépasser/);
  });

  it("refuse un mot de passe d'une seule classe de caractères", () => {
    expect(assessPasswordStrength("azertyuiopqsdf")).toMatch(/types de caractères/);
  });
});

describe("collectRegistrationErrors", () => {
  const ok = { email: "alice@example.com", password: "Corr3ct-horse-battery" };

  it("ne remonte rien pour une entrée valide", () => {
    expect(collectRegistrationErrors(ok)).toEqual({});
    expect(isRegistrationInputValid(ok)).toBe(true);
  });

  it("signale un e-mail manquant puis invalide", () => {
    expect(collectRegistrationErrors({ ...ok, email: "" }).email).toMatch(/requise/);
    expect(collectRegistrationErrors({ ...ok, email: "nope" }).email).toMatch(/valide/);
  });

  it("signale un mot de passe manquant puis faible", () => {
    expect(collectRegistrationErrors({ ...ok, password: "" }).password).toMatch(/requis/);
    expect(collectRegistrationErrors({ ...ok, password: "court1" }).password).toBeDefined();
  });

  it("peut remonter les deux champs à la fois", () => {
    const errors = collectRegistrationErrors({ email: "x", password: "y" });
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });
});
