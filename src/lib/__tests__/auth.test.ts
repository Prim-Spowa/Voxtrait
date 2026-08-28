import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateUtilisateur,
  CompteSuspenduError,
  EmailDejaUtiliseError,
  InvalidCredentialsError,
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
  seedMockUtilisateur,
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

describe("authenticateUtilisateur", () => {
  // Le hacher factice produit "fakehash:<clair>" ; on sème donc un compte
  // avec le hash correspondant au mot de passe attendu.
  async function seedAlice(overrides: { statut?: "ACTIF" | "SUSPENDU" } = {}) {
    return seedMockUtilisateur({
      email: "alice@example.com",
      motDePasseHash: await hasher.hash("Corr3ct-horse-battery"),
      ...overrides,
    });
  }

  it("accepte les bons identifiants et renvoie la forme publique (sans hash)", async () => {
    const seeded = await seedAlice();
    const user = await authenticateUtilisateur(mockUtilisateurDelegate, hasher, {
      email: "  ALICE@Example.com ",
      password: "Corr3ct-horse-battery",
    });
    expect(user.id).toBe(seeded.id);
    expect(user.email).toBe("alice@example.com");
    expect(Object.keys(user)).not.toContain("motDePasseHash");
  });

  it("rejette un mot de passe faux avec InvalidCredentialsError", async () => {
    await seedAlice();
    await expect(
      authenticateUtilisateur(mockUtilisateurDelegate, hasher, {
        email: "alice@example.com",
        password: "mauvais-mot-de-passe",
      })
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejette un e-mail inconnu avec la même erreur (anti-énumération) après avoir tenté une vérification", async () => {
    const verify = vi.spyOn(hasher, "verify");
    await expect(
      authenticateUtilisateur(mockUtilisateurDelegate, hasher, {
        email: "inconnu@example.com",
        password: "peu-importe-mais-long",
      })
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    // Une vérification est bien lancée même sans compte (égalisation du temps de réponse).
    expect(verify).toHaveBeenCalled();
    verify.mockRestore();
  });

  it("rejette un champ manquant sans révéler lequel", async () => {
    const delegate = { findFirst: vi.fn(), create: vi.fn() } satisfies UtilisateurDelegate;
    await expect(
      authenticateUtilisateur(delegate, hasher, { email: "", password: "" })
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(delegate.findFirst).not.toHaveBeenCalled();
  });

  it("refuse un compte suspendu même avec les bons identifiants", async () => {
    await seedAlice({ statut: "SUSPENDU" });
    await expect(
      authenticateUtilisateur(mockUtilisateurDelegate, hasher, {
        email: "alice@example.com",
        password: "Corr3ct-horse-battery",
      })
    ).rejects.toBeInstanceOf(CompteSuspenduError);
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
