/**
 * Hachage des mots de passe — ST 4.1 « Inscription », découpage en tâches :
 * « hash du mot de passe (argon2/bcrypt) ».
 *
 * ⚠️ Écart assumé vs la story. La story recommande **argon2** (à défaut
 * bcrypt). Les deux sont des dépendances natives (compilation `node-gyp`),
 * absentes du `package.json` — même situation que FFmpeg / BullMQ / le client
 * S3 pour ST 3.1, non installés dans ce projet. Plutôt que d'ajouter une
 * dépendance native non validée, on utilise **scrypt**, fourni par la
 * bibliothèque standard Node (`node:crypto`) : fonction de dérivation de clé
 * à coût mémoire, listée par l'OWASP comme alternative acceptable à argon2 /
 * bcrypt. Le contrat `PasswordHasher` ci-dessous permet de basculer vers
 * argon2 sans toucher au reste du code (`registerUtilisateur`, ST 4.2 login) —
 * point signalé en notes de dev pour arbitrage en revue.
 *
 * Ce module est **serveur uniquement** (`node:crypto`) : la logique partagée
 * avec le formulaire vit dans `lib/authClient.ts`.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * `promisify(scrypt)` perd la surcharge à 4 arguments (avec `options`) dans
 * les types Node : on la réintroduit explicitement ici.
 */
type ScryptOptions = { N?: number; r?: number; p?: number; maxmem?: number };
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: ScryptOptions
) => Promise<Buffer>;

/**
 * Paramètres scrypt. `N` (coût CPU/mémoire) = 2^15 : recommandation courante
 * pour une authentification interactive (~50-100 ms par hash sur un serveur
 * moderne). `r` et `p` aux valeurs par défaut. `keyLen` = 64 octets.
 *
 * `maxmem` est relevé car `N=2^15, r=8` dépasse la limite par défaut de Node
 * (32 Mio) : coût mémoire ≈ `128 * N * r` ≈ 32 Mio, on laisse de la marge.
 */
export const SCRYPT_PARAMS = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  keyLen: 64,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024,
} as const;

/** Préfixe d'algorithme stocké — permet une migration future (argon2, bump de coût). */
const SCRYPT_PREFIX = "scrypt";

/**
 * Contrat de hachage, injecté dans `registerUtilisateur` (et, à terme, dans
 * la vérification de connexion ST 4.2) — testable avec une implémentation
 * factice rapide (`createFakePasswordHasher`, cf. `mocks/auth.mock.ts`).
 */
export interface PasswordHasher {
  /** Produit une représentation stockable (algo + paramètres + sel + hash). */
  hash(plain: string): Promise<string>;
  /** Vérifie un mot de passe candidat contre une valeur stockée. */
  verify(plain: string, stored: string): Promise<boolean>;
}

/**
 * Sérialise un hash scrypt en une seule chaîne auto-décrivante :
 * `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`. Tout est contenu dans la colonne
 * `mot_de_passe_hash` — pas de colonne de sel séparée à gérer.
 */
function serialize(salt: Buffer, derived: Buffer): string {
  const { N, r, p } = SCRYPT_PARAMS;
  return [
    SCRYPT_PREFIX,
    N,
    r,
    p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return null;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(saltB64!, "base64"),
      hash: Buffer.from(hashB64!, "base64"),
    };
  } catch {
    return null;
  }
}

/**
 * Implémentation scrypt du `PasswordHasher`.
 *
 * `verify` relit les paramètres (`N`, `r`, `p`) stockés dans la valeur — un
 * hash produit avec d'anciens paramètres reste vérifiable après un bump de
 * `SCRYPT_PARAMS`. La comparaison finale passe par `timingSafeEqual` pour ne
 * pas fuiter d'information par canal temporel.
 */
export function createScryptPasswordHasher(): PasswordHasher {
  return {
    async hash(plain: string): Promise<string> {
      if (typeof plain !== "string" || plain.length === 0) {
        throw new Error("password.hash: mot de passe vide ou invalide.");
      }
      const salt = randomBytes(SCRYPT_PARAMS.saltBytes);
      const derived = (await scryptAsync(plain, salt, SCRYPT_PARAMS.keyLen, {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: SCRYPT_PARAMS.maxmem,
      })) as Buffer;
      return serialize(salt, derived);
    },

    async verify(plain: string, stored: string): Promise<boolean> {
      const parsed = parse(stored);
      if (!parsed || typeof plain !== "string") return false;
      let candidate: Buffer;
      try {
        candidate = (await scryptAsync(plain, parsed.salt, parsed.hash.length, {
          N: parsed.N,
          r: parsed.r,
          p: parsed.p,
          maxmem: SCRYPT_PARAMS.maxmem,
        })) as Buffer;
      } catch {
        return false;
      }
      if (candidate.length !== parsed.hash.length) return false;
      return timingSafeEqual(candidate, parsed.hash);
    },
  };
}
