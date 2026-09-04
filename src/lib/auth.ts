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
  collectLoginErrors,
  collectRegistrationErrors,
  LOGIN_GENERIC_ERROR,
  normalizeEmail,
  type LoginInput,
  type RegistrationFieldErrors,
  type RegistrationInput,
  type UtilisateurPublic,
} from "@/lib/authClient";
import type { PasswordHasher } from "@/lib/password";
import { CGU_VERSION } from "@/lib/cgu";

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
 * Identifiants de connexion invalides (e-mail inconnu **ou** mauvais mot de
 * passe) — ST 4.2. Un seul type d'erreur pour les deux cas : mène à un `401`
 * avec le message générique `LOGIN_GENERIC_ERROR` (anti-énumération de comptes).
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super(LOGIN_GENERIC_ERROR);
    this.name = "InvalidCredentialsError";
  }
}

/**
 * Le compte existe et le mot de passe est bon, mais il est suspendu par la
 * modération (`statut = SUSPENDU`, cf. ST 7.2, non développé) — mène à un `403`.
 * Distinct de `InvalidCredentialsError` : ici l'utilisateur a prouvé son
 * identité, le refus n'apprend donc rien à un attaquant.
 */
export class CompteSuspenduError extends Error {
  constructor() {
    super("Ce compte a été suspendu. Contactez la modération.");
    this.name = "CompteSuspenduError";
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
  /** ST 4.3 — mise à jour de l'acceptation des CGU (`acceptCguPourUtilisateur`). */
  update: (args: Prisma.UtilisateurUpdateArgs) => Promise<Utilisateur>;
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
    // ST 7.2 — rôle applicatif. `?? "UTILISATEUR"` : garde-fou si la colonne
    // n'est pas encore présente (client Prisma non régénéré / mock ancien).
    role: user.role ?? "UTILISATEUR",
    dateCreation: user.dateCreation.toISOString(),
    // ST 4.3 — état d'acceptation des CGU (jamais le hash du mot de passe).
    cguAccepteesLe: user.cguAccepteesLe ? user.cguAccepteesLe.toISOString() : null,
    cguVersionAcceptee: user.cguVersionAcceptee ?? null,
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
      // ST 4.3 — l'acceptation des CGU (case obligatoire, validée ci-dessus)
      // est enregistrée dès la création : horodatage + version acceptée, ce
      // qui constitue la preuve datée demandée (ST 4.3, points d'attention).
      data: {
        email,
        motDePasseHash,
        statut: "ACTIF",
        cguAccepteesLe: new Date(),
        cguVersionAcceptee: CGU_VERSION,
      },
    });
    return toUtilisateurPublic(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new EmailDejaUtiliseError();
    }
    throw err;
  }
}

/**
 * Hash factice, syntaxiquement invalide, utilisé quand l'e-mail est inconnu :
 * on lance quand même une vérification de mot de passe pour que le temps de
 * réponse d'un e-mail inexistant soit comparable à celui d'un e-mail existant
 * (atténuation d'un oracle temporel d'énumération de comptes). `verify`
 * retourne `false` sur cette valeur.
 */
const DUMMY_PASSWORD_HASH = "scrypt$0$0$0$AA==$AA==";

/**
 * Vérifie un couple e-mail / mot de passe et renvoie la forme publique du
 * compte — ST 4.2 « Connexion / déconnexion », découpage en tâches point 1
 * (« Endpoint login »).
 *
 * Ordre voulu :
 *  1. présence des deux champs (`collectLoginErrors`) — sinon
 *     `InvalidCredentialsError` (pas d'erreur par champ détaillée, cf.
 *     `LOGIN_GENERIC_ERROR`) ;
 *  2. lecture du compte par e-mail normalisé ;
 *  3. vérification du mot de passe — `hasher.verify`, à temps constant en
 *     interne (`timingSafeEqual`, cf. `lib/password.ts`). Si l'e-mail est
 *     inconnu, on vérifie contre `DUMMY_PASSWORD_HASH` pour égaliser le temps
 *     de réponse ;
 *  4. contrôle du statut du compte (`SUSPENDU` → `CompteSuspenduError`).
 *
 * Ne crée **pas** la session : l'émission du jeton et la pose du cookie sont
 * faites par le Route Handler (`POST /api/auth/login`), comme pour
 * l'inscription.
 *
 * @throws {InvalidCredentialsError} champ manquant, e-mail inconnu ou mot de passe faux
 * @throws {CompteSuspenduError} identifiants corrects mais compte suspendu
 */
export async function authenticateUtilisateur(
  delegate: UtilisateurDelegate,
  hasher: PasswordHasher,
  input: LoginInput
): Promise<UtilisateurPublic> {
  if (Object.keys(collectLoginErrors(input)).length > 0) {
    throw new InvalidCredentialsError();
  }

  const email = normalizeEmail(input.email);
  const user = await delegate.findFirst({ where: { email } });

  const passwordOk = await hasher.verify(
    input.password,
    user?.motDePasseHash ?? DUMMY_PASSWORD_HASH
  );
  if (!user || !passwordOk) {
    throw new InvalidCredentialsError();
  }

  if (user.statut === "SUSPENDU") {
    throw new CompteSuspenduError();
  }

  return toUtilisateurPublic(user);
}

/* -------------------------------------------------------------------------- */
/*  ST 4.3 — Acceptation des CGU (fan-usage)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Le compte visé par une acceptation de CGU n'existe pas / plus (jeton de
 * session valide mais utilisateur supprimé depuis) — mène à un `401`.
 */
export class UtilisateurIntrouvableError extends Error {
  constructor() {
    super("Compte introuvable.");
    this.name = "UtilisateurIntrouvableError";
  }
}

/**
 * Enregistre l'acceptation de la version **courante** des CGU par un
 * utilisateur — ST 4.3, découpage en tâches point 3 : « Endpoint de mise à
 * jour de l'acceptation (utile si les CGU évoluent) ».
 *
 * Appelée par `POST /api/auth/cgu` une fois la session vérifiée (ST 4.2). On
 * ré-écrit systématiquement `cguAccepteesLe` (nouvel horodatage) et
 * `cguVersionAcceptee = CGU_VERSION` : idempotent côté effet métier, et
 * ré-accepter une nouvelle version écrase proprement l'ancienne trace.
 *
 * La preuve datée de chaque acceptation successive n'est **pas** historisée
 * ici (une seule ligne par compte) — signalé en notes de dev comme évolution
 * possible (table d'audit) si une traçabilité complète devient nécessaire.
 *
 * @throws {UtilisateurIntrouvableError} aucun compte pour cet identifiant
 */
export async function acceptCguPourUtilisateur(
  delegate: UtilisateurDelegate,
  utilisateurId: string
): Promise<UtilisateurPublic> {
  const id = (utilisateurId ?? "").trim();
  if (!id) throw new UtilisateurIntrouvableError();

  const existing = await delegate.findFirst({ where: { id } });
  if (!existing) throw new UtilisateurIntrouvableError();

  const updated = await delegate.update({
    where: { id },
    data: { cguAccepteesLe: new Date(), cguVersionAcceptee: CGU_VERSION },
  });
  return toUtilisateurPublic(updated);
}
