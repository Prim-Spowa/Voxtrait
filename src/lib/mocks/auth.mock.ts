import type { Prisma, Utilisateur } from "@prisma/client";
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

function readEmailEquals(where: Prisma.UtilisateurWhereInput | undefined): string | undefined {
  const email = (where as { email?: unknown } | undefined)?.email;
  if (typeof email === "string") return email;
  if (email && typeof email === "object" && "equals" in email) {
    const eq = (email as { equals?: unknown }).equals;
    return typeof eq === "string" ? eq : undefined;
  }
  return undefined;
}

/**
 * `UtilisateurDelegate` en mémoire. Ne gère que ce dont `registerUtilisateur`
 * a besoin : `findFirst({ where: { email } })` (égalité) et `create`. Émule la
 * contrainte `@unique` sur `email` en levant une erreur `code: "P2002"`,
 * comme Prisma, pour exercer le rattrapage de course dans `registerUtilisateur`.
 */
export const mockUtilisateurDelegate: UtilisateurDelegate = {
  async findFirst(args) {
    const email = readEmailEquals(args?.where);
    if (email === undefined) return null;
    return getStore().rows.find((row) => row.email === email) ?? null;
  },

  async create(args) {
    const store = getStore();
    const data = args.data as {
      email: string;
      motDePasseHash: string;
      statut?: Utilisateur["statut"];
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
      dateCreation: now,
      updatedAt: now,
    };
    store.rows.push(row);
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
