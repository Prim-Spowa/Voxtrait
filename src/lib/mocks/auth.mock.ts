import type { Utilisateur } from "@prisma/client";
import type { UtilisateurDelegate } from "@/lib/auth";
import type { PasswordHasher } from "@/lib/password";

/**
 * Adaptateurs mock pour l'inscription (ST 4.1) — utilisés quand
 * `DATA_SOURCE=mock` (cf. `src/lib/config.ts`) et dans les tests, à la place
 * de `prisma.utilisateur` et du hacher scrypt réel.
 *
 * - `mockUtilisateurDelegate` : `UtilisateurDelegate` en mémoire (store
 *   `globalThis` partagé au sein d'un process, comme `getDoublageJobStore`
 *   ST 3.1) — un compte créé via `POST /api/auth/register` en mode mock
 *   restera visible pour la connexion (ST 4.2) tant que le process vit.
 *   Gère `findFirst` / `create` (ST 4.1-4.2) et `update` (ST 4.3 :
 *   acceptation des CGU via `acceptCguPourUtilisateur`).
 * - `createFakePasswordHasher` : hache en clair préfixé (rapide, déterministe)
 *   pour les tests de `registerUtilisateur` sans payer le coût CPU de scrypt.
 *   **Jamais** utilisé en dehors des tests / du mode mock.
 * - `resetMockUtilisateurs` : vide le store entre deux tests.
 */

interface UtilisateurStore {
  rows: Utilisateur[];
  nextId: number;
}

const globalForAuth = globalThis as unknown as { utilisateurStore?: UtilisateurStore };

function getStore(): UtilisateurStore {
  if (!globalForAuth.utilisateurStore) {
    globalForAuth.utilisateurStore = { rows: [], nextId: 1 };
  }
  return globalForAuth.utilisateurStore;
}

/** Vide le store mock — à appeler dans un `beforeEach`/`afterEach` de test. */
export function resetMockUtilisateurs(): void {
  const store = getStore();
  store.rows = [];
  store.nextId = 1;
}

/** Lecture brute du store (tests : vérifier qu'une ligne a bien été créée). */
export function listMockUtilisateurs(): readonly Utilisateur[] {
  return getStore().rows;
}

/**
 * Insère directement un compte dans le store mock (ST 4.2 : tester la
 * connexion sans passer par le flux d'inscription). `motDePasseHash` doit
 * être une valeur produite par le hacher utilisé dans le test — typiquement
 * `await createFakePasswordHasher().hash("...")`, soit `"fakehash:..."`.
 */
export function seedMockUtilisateur(
  overrides: Partial<Utilisateur> & { motDePasseHash: string }
): Utilisateur {
  const store = getStore();
  const now = new Date();
  const row: Utilisateur = {
    id: `mock-user-${String(store.nextId++).padStart(3, "0")}`,
    email: "seed@example.com",
    statut: "ACTIF",
    // ST 7.2 — rôle par défaut ; un test de modération passe `role: "MODERATEUR"`.
    role: "UTILISATEUR",
    dateCreation: now,
    updatedAt: now,
    // ST 4.3 — par défaut, un compte semé n'a pas accepté les CGU.
    cguAccepteesLe: null,
    cguVersionAcceptee: null,
    ...overrides,
  };
  store.rows.push(row);
  return row;
}

/** Extrait une valeur `string` d'une clause d'égalité Prisma (`x` ou `{ equals: x }`). */
function readStringEquals(clause: unknown): string | undefined {
  if (typeof clause === "string") return clause;
  if (clause && typeof clause === "object" && "equals" in clause) {
    const eq = (clause as { equals?: unknown }).equals;
    return typeof eq === "string" ? eq : undefined;
  }
  return undefined;
}

/**
 * `UtilisateurDelegate` en mémoire. Gère ce dont `registerUtilisateur` (ST 4.1)
 * et `authenticateUtilisateur` / `GET /api/auth/session` (ST 4.2) ont besoin :
 * `findFirst({ where: { email } })` et `findFirst({ where: { id } })`
 * (égalité), plus `create`. Émule la contrainte `@unique` sur `email` en
 * levant une erreur `code: "P2002"`, comme Prisma, pour exercer le rattrapage
 * de course dans `registerUtilisateur`.
 */
export const mockUtilisateurDelegate: UtilisateurDelegate = {
  async findFirst(args) {
    const where = args?.where as { email?: unknown; id?: unknown } | undefined;
    const email = readStringEquals(where?.email);
    if (email !== undefined) {
      return getStore().rows.find((row) => row.email === email) ?? null;
    }
    const id = readStringEquals(where?.id);
    if (id !== undefined) {
      return getStore().rows.find((row) => row.id === id) ?? null;
    }
    return null;
  },

  async create(args) {
    const store = getStore();
    const data = args.data as {
      email: string;
      motDePasseHash: string;
      statut?: Utilisateur["statut"];
      role?: Utilisateur["role"];
      cguAccepteesLe?: Date | null;
      cguVersionAcceptee?: string | null;
    };

    if (store.rows.some((row) => row.email === data.email)) {
      throw Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
        code: "P2002",
      });
    }

    const now = new Date();
    const row: Utilisateur = {
      id: `mock-user-${String(store.nextId++).padStart(3, "0")}`,
      email: data.email,
      motDePasseHash: data.motDePasseHash,
      statut: data.statut ?? "ACTIF",
      role: data.role ?? "UTILISATEUR",
      dateCreation: now,
      updatedAt: now,
      cguAccepteesLe: data.cguAccepteesLe ?? null,
      cguVersionAcceptee: data.cguVersionAcceptee ?? null,
    };
    store.rows.push(row);
    return row;
  },

  // Gère :
  //  - ST 4.3 `acceptCguPourUtilisateur` : `{ cguAccepteesLe, cguVersionAcceptee }` ;
  //  - ST 7.2 `suspendreCompte` : `{ statut: "SUSPENDU" }` ;
  //  - promotion d'un compte : `{ role }`.
  async update(args) {
    const id = readStringEquals((args.where as { id?: unknown }).id);
    const row = getStore().rows.find((r) => r.id === id);
    if (!row) {
      throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
    }
    const data = args.data as {
      cguAccepteesLe?: Date | null;
      cguVersionAcceptee?: string | null;
      statut?: Utilisateur["statut"];
      role?: Utilisateur["role"];
    };
    if ("cguAccepteesLe" in data) row.cguAccepteesLe = data.cguAccepteesLe ?? null;
    if ("cguVersionAcceptee" in data) row.cguVersionAcceptee = data.cguVersionAcceptee ?? null;
    if (data.statut !== undefined) row.statut = data.statut;
    if (data.role !== undefined) row.role = data.role;
    row.updatedAt = new Date();
    return row;
  },
};

const FAKE_PREFIX = "fakehash:";

/**
 * Hacher factice pour les tests : `hash("secret") === "fakehash:secret"`.
 * `verify` compare la valeur en clair. Aucune propriété cryptographique —
 * l'objectif est uniquement de rendre `registerUtilisateur` testable
 * rapidement.
 */
export function createFakePasswordHasher(): PasswordHasher {
  return {
    async hash(plain: string): Promise<string> {
      return `${FAKE_PREFIX}${plain}`;
    },
    async verify(plain: string, stored: string): Promise<boolean> {
      return stored === `${FAKE_PREFIX}${plain}`;
    },
  };
}
