import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmailDejaUtiliseError,
  RegistrationValidationError,
  registerUtilisateur,
  toUtilisateurPublic,
  type UtilisateurDelegate,
} from "../auth";
import {
  createFakePasswordHasher,
  listMockUtilisateurs,
  mockUtilisateurDelegate,
  resetMockUtilisateurs,
} from "../mocks/auth.mock";

// ST 4.1 — orchestration de l'inscription : validation, unicité e-mail,
// hachage, création. Delegate et hacher injectés (pas de Postgres, pas de
// scrypt réel).

const hasher = createFakePasswordHasher();
const VALID = { email: "Alice@Example.com", password: "Corr3ct-horse-battery" };

beforeEach(() => resetMockUtilisateurs());

describe("registerUtilisateur", () => {
  it("crée un compte, normalise l'e-mail et ne renvoie jamais le hash", async () => {
    const user = await registerUtilisateur(mockUtilisateurDelegate, hasher, VALID);

    expect(user.email).toBe("alice@example.com");
    expect(user.statut).toBe("ACTIF");
    expect(user.dateCreation).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(user)).not.toContain("motDePasseHash");

    const [row] = listMockUtilisateurs();
    expect(row?.motDePasseHash).toBe("fakehash:Corr3ct-horse-battery");
  });

  it("rejette une entrée invalide sans toucher au delegate", async () => {
    const delegate = {
      findFirst: vi.fn(),
      create: vi.fn(),
    } satisfies UtilisateurDelegate;

    await expect(
      registerUtilisateur(delegate, hasher, { email: "pas-un-email", password: "court" })
    ).rejects.toBeInstanceOf(RegistrationValidationError);

    expect(delegate.findFirst).not.toHaveBeenCalled();
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it("expose les erreurs par champ pour le formulaire", async () => {
    const error = await registerUtilisateur(mockUtilisateurDelegate, hasher, {
      email: "x",
      password: "y",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(RegistrationValidationError);
    expect(error.fieldErrors.email).toBeDefined();
    expect(error.fieldErrors.password).toBeDefined();
  });

  it("refuse un e-mail déjà utilisé (casse/espaces ignorés)", async () => {
    await registerUtilisateur(mockUtilisateurDelegate, hasher, VALID);
    await expect(
      registerUtilisateur(mockUtilisateurDelegate, hasher, {
        email: "  ALICE@example.com ",
        password: "Un-autre-mot-de-passe-1",
      })
    ).rejects.toBeInstanceOf(EmailDejaUtiliseError);
    expect(listMockUtilisateurs()).toHaveLength(1);
  });

  it("rattrape une violation d'unicité concurrente (P2002) en EmailDejaUtiliseError", async () => {
    const delegate = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
    } satisfies UtilisateurDelegate;

    await expect(registerUtilisateur(delegate, hasher, VALID)).rejects.toBeInstanceOf(
      EmailDejaUtiliseError
    );
  });

  it("ne traite pas une chaîne d'injection SQL comme un e-mail valide", async () => {
    const delegate = { findFirst: vi.fn(), create: vi.fn() } satisfies UtilisateurDelegate;
    await expect(
      registerUtilisateur(delegate, hasher, {
        email: "'; DROP TABLE utilisateurs; --@x.com",
        password: "Corr3ct-horse-battery",
      })
    ).rejects.toBeInstanceOf(RegistrationValidationError);
    expect(delegate.findFirst).not.toHaveBeenCalled();
  });
});

describe("toUtilisateurPublic", () => {
  it("ne conserve que id, email, statut, dateCreation", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    const publicView = toUtilisateurPublic({
      id: "u1",
      email: "a@b.com",
      motDePasseHash: "secret",
      statut: "ACTIF",
      dateCreation: now,
      updatedAt: now,
    });
    expect(publicView).toEqual({
      id: "u1",
      email: "a@b.com",
      statut: "ACTIF",
      dateCreation: now.toISOString(),
    });
  });
});
