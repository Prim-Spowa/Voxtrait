/**
 * Orchestration serveur de l'inscription — ST 4.1 « Inscription » (US 4.1 :
 * créer un compte).
 *
 * Découpage en tâches ST 4.1 :
 *  1. Modéliser la table `Utilisateur`                  → `prisma/schema.prisma`
 *  2. Endpoint d'inscription avec validation            → `src/app/api/auth/register/route.ts` + ce module (`registerUtilisateur`)
 *  3. Formulaire frontend avec messages d'erreur        → `src/components/RegisterForm.tsx`
 *
 * Séparation logique / route identique au reste du projet (`lib/extraits.ts`
 * ST 1.1, `lib/doublage.ts` ST 3.1) : testable sans runtime Next ni base
 * réelle grâce au delegate Prisma injecté (`UtilisateurDelegate`). Importe
 * `@prisma/client` → réservé au serveur ; la logique partagée avec le
 * formulaire vit dans `lib/authClient.ts`.
 */

import type { Prisma, Utilisateur } from "@prisma/client";
import {
  collectRegistrationErrors,
  normalizeEmail,
  type RegistrationFieldErrors,
  type RegistrationInput,
  type UtilisateurPublic,
} from "@/lib/authClient";
import type { PasswordHasher } from "@/lib/password";

/** Entrée invalide (format e-mail, robustesse mot de passe) — mène à un 400. */
export class RegistrationValidationError extends Error {
  /** Erreurs par champ, réutilisées telles quelles par le formulaire. */
  readonly fieldErrors: RegistrationFieldErrors;
  constructor(fieldErrors: RegistrationFieldErrors) {
    super("Les informations d'inscription sont invalides.");
    this.name = "RegistrationValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/** L'e-mail est déjà associé à un compte — mène à un 409. */
export class EmailDejaUtiliseError extends Error {
  constructor() {
    super("Un compte existe déjà avec cette adresse e-mail.");
    this.name = "EmailDejaUtiliseError";
  }
}

/**
 * Sous-ensemble de `prisma.utilisateur` utilisé ici — permet un mock simple
 * en test (cf. `src/lib/mocks/auth.mock.ts`), comme `ExtraitDelegate` (ST 1.1)
 * ou `ScriptLigneDelegate` (ST 1.3).
 */
export type UtilisateurDelegate = {
  findFirst: (args: Prisma.UtilisateurFindFirstArgs) => Promise<Utilisateur | null>;
  create: (args: Prisma.UtilisateurCreateArgs) => Promise<Utilisateur>;
};

/** Code d'erreur Prisma pour une violation de contrainte d'unicité. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

/** Projette la ligne `Utilisateur` vers la forme publique — sans le hash. */
export function toUtilisateurPublic(user: Utilisateur): UtilisateurPublic {
  return {
    id: user.id,
    email: user.email,
    statut: user.statut,
    dateCreation: user.dateCreation.toISOString(),
  };
}

/**
 * Crée un compte : valide l'entrée, vérifie l'unicité de l'e-mail, hache le
 * mot de passe, insère la ligne.
 *
 * Ordre voulu :
 *  1. validation de forme (aucun accès base si l'entrée est invalide — écarte
 *     aussi les chaînes hostiles avant qu'elles n'atteignent la couche
 *     données) ;
 *  2. contrôle d'unicité explicite (`findFirst`) → message clair « e-mail
 *     déjà utilisé » ;
 *  3. hachage puis `create`, avec rattrapage d'une violation d'unicité
 *     concurrente (`P2002`) : deux inscriptions simultanées sur le même
 *     e-mail — la contrainte `@unique` en base est le garde-fou final.
 *
 * @throws {RegistrationValidationError} entrée invalide
 * @throws {EmailDejaUtiliseError} e-mail déjà pris
 */
export async function registerUtilisateur(
  delegate: UtilisateurDelegate,
  hasher: PasswordHasher,
  input: RegistrationInput
): Promise<UtilisateurPublic> {
  const fieldErrors = collectRegistrationErrors(input);
  if (Object.keys(fieldErrors).length > 0) {
    throw new RegistrationValidationError(fieldErrors);
  }

  const email = normalizeEmail(input.email);

  const existing = await delegate.findFirst({ where: { email } });
  if (existing) {
    throw new EmailDejaUtiliseError();
  }

  const motDePasseHash = await hasher.hash(input.password);

  try {
    const created = await delegate.create({
      data: { email, motDePasseHash, statut: "ACTIF" },
    });
    return toUtilisateurPublic(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new EmailDejaUtiliseError();
    }
    throw err;
  }
}
