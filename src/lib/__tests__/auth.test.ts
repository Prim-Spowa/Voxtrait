import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCguPourUtilisateur,
  authenticateUtilisateur,
  CompteSuspenduError,
  EmailDejaUtiliseError,
  InvalidCredentialsError,
  RegistrationValidationError,
  registerUtilisateur,
  toUtilisateurPublic,
  UtilisateurIntrouvableError,
  type UtilisateurDelegate,
} from "../auth";
import { aAccepteCguActuelles, CGU_VERSION } from "../cgu";
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
const VALID = {
  email: "Alice@Example.com",
  password: "Corr3ct-horse-battery",
  nom: "Martin",
  prenom: "Alice",
  age: 28,
  accepteCgu: true,
};

beforeEach(() => resetMockUtilisateurs());

describe("registerUtilisateur", () => {
  it("crée un compte, normalise l'e-mail et ne renvoie jamais le hash", async () => {
    const user = await registerUtilisateur(mockUtilisateurDelegate, hasher, VALID);

    expect(user.email).toBe("alice@example.com");
    expect(user.statut).toBe("ACTIF");
    expect(user.nom).toBe("Martin");
    expect(user.prenom).toBe("Alice");
    expect(user.age).toBe(28);
    expect(user.dateCreation).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(user)).not.toContain("motDePasseHash");

    const [row] = listMockUtilisateurs();
    expect(row?.motDePasseHash).toBe("fakehash:Corr3ct-horse-battery");
  });

  it("rejette nom/prénom vides et un âge hors borne réaliste (mise à jour ST 4.1)", async () => {
    const delegate = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } satisfies UtilisateurDelegate;

    const error = await registerUtilisateur(delegate, hasher, {
      ...VALID,
      nom: "  ",
      prenom: "",
      age: 200,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RegistrationValidationError);
    expect(error.fieldErrors.nom).toMatch(/requis/i);
    expect(error.fieldErrors.prenom).toMatch(/requis/i);
    expect(error.fieldErrors.age).toMatch(/compris entre/i);
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it("rejette un âge non entier", async () => {
    const delegate = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } satisfies UtilisateurDelegate;
    const error = await registerUtilisateur(delegate, hasher, { ...VALID, age: 28.5 }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(RegistrationValidationError);
    expect(error.fieldErrors.age).toMatch(/entier/i);
  });

  it("enregistre l'acceptation des CGU à la création (ST 4.3)", async () => {
    const user = await registerUtilisateur(mockUtilisateurDelegate, hasher, VALID);
    expect(user.cguVersionAcceptee).toBe(CGU_VERSION);
    expect(user.cguAccepteesLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(aAccepteCguActuelles(user)).toBe(true);
  });

  it("refuse l'inscription si les CGU ne sont pas acceptées (ST 4.3)", async () => {
    const delegate = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } satisfies UtilisateurDelegate;
    const error = await registerUtilisateur(delegate, hasher, {
      ...VALID,
      accepteCgu: false,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(RegistrationValidationError);
    expect(error.fieldErrors.cgu).toBeDefined();
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it("rejette une entrée invalide sans toucher au delegate", async () => {
    const delegate = {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
        nom: "Martin",
        prenom: "Alice",
        age: 28,
        accepteCgu: true,
      })
    ).rejects.toBeInstanceOf(EmailDejaUtiliseError);
    expect(listMockUtilisateurs()).toHaveLength(1);
  });

  it("rattrape une violation d'unicité concurrente (P2002) en EmailDejaUtiliseError", async () => {
    const delegate = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" })),
      update: vi.fn(),
    } satisfies UtilisateurDelegate;

    await expect(registerUtilisateur(delegate, hasher, VALID)).rejects.toBeInstanceOf(
      EmailDejaUtiliseError
    );
  });

  it("ne traite pas une chaîne d'injection SQL comme un e-mail valide", async () => {
    const delegate = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } satisfies UtilisateurDelegate;
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
    const delegate = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } satisfies UtilisateurDelegate;
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
  it("ne conserve que les champs publics et jamais le hash", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    const publicView = toUtilisateurPublic({
      id: "u1",
      email: "a@b.com",
      motDePasseHash: "secret",
      statut: "ACTIF",
      // ST 7.2 — rôle applicatif.
      role: "MODERATEUR",
      nom: "Dupont",
      prenom: "Jean",
      age: 42,
      dateCreation: now,
      updatedAt: now,
      cguAccepteesLe: now,
      cguVersionAcceptee: CGU_VERSION,
    });
    expect(publicView).toEqual({
      id: "u1",
      email: "a@b.com",
      statut: "ACTIF",
      role: "MODERATEUR",
      nom: "Dupont",
      prenom: "Jean",
      age: 42,
      dateCreation: now.toISOString(),
      cguAccepteesLe: now.toISOString(),
      cguVersionAcceptee: CGU_VERSION,
    });
  });

  it("expose cguAccepteesLe = null quand les CGU n'ont jamais été acceptées", () => {
    const now = new Date("2026-08-28T12:00:00Z");
    const publicView = toUtilisateurPublic({
      id: "u1",
      email: "a@b.com",
      motDePasseHash: "secret",
      statut: "ACTIF",
      role: "UTILISATEUR",
      nom: "Dupont",
      prenom: "Jean",
      age: 42,
      dateCreation: now,
      updatedAt: now,
      cguAccepteesLe: null,
      cguVersionAcceptee: null,
    });
    expect(publicView.cguAccepteesLe).toBeNull();
    expect(publicView.cguVersionAcceptee).toBeNull();
  });
});

describe("acceptCguPourUtilisateur (ST 4.3)", () => {
  it("enregistre l'acceptation de la version courante pour un compte existant", async () => {
    const seeded = seedMockUtilisateur({
      email: "bob@example.com",
      motDePasseHash: await hasher.hash("peu-importe-ici-long"),
    });
    expect(aAccepteCguActuelles(seeded)).toBe(false);

    const updated = await acceptCguPourUtilisateur(mockUtilisateurDelegate, seeded.id);

    expect(updated.cguVersionAcceptee).toBe(CGU_VERSION);
    expect(updated.cguAccepteesLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(aAccepteCguActuelles(updated)).toBe(true);
  });

  it("lève UtilisateurIntrouvableError pour un identifiant inconnu", async () => {
    await expect(
      acceptCguPourUtilisateur(mockUtilisateurDelegate, "mock-user-inexistant")
    ).rejects.toBeInstanceOf(UtilisateurIntrouvableError);
  });

  it("lève UtilisateurIntrouvableError pour un identifiant vide", async () => {
    const delegate = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } satisfies UtilisateurDelegate;
    await expect(acceptCguPourUtilisateur(delegate, "   ")).rejects.toBeInstanceOf(
      UtilisateurIntrouvableError
    );
    expect(delegate.findFirst).not.toHaveBeenCalled();
  });
});
