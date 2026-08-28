/**
 * Logique client-safe de l'inscription — ST 4.1 « Inscription » (US 4.1 :
 * créer un compte).
 *
 * Séparée de `lib/auth.ts` (orchestration serveur : hash du mot de passe,
 * unicité en base, création de session) pour pouvoir être importée depuis le
 * composant `"use client"` `RegisterForm` sans faire entrer de code serveur
 * (`node:crypto`, `@prisma/client`) dans le bundle navigateur — même
 * séparation que `doublageClient.ts` vs `doublage.ts` (ST 3.1) ou
 * `scriptClient.ts` vs `script.ts` (ST 1.3).
 *
 * Contient : la normalisation de l'e-mail, les règles de validation du format
 * e-mail et de robustesse du mot de passe (source de vérité unique,
 * partagée entre le formulaire et le endpoint `POST /api/auth/register`), et
 * le texte d'information RGPD affiché à la saisie.
 */

/**
 * Statut d'un compte — miroir client-safe de l'enum Prisma
 * `StatutUtilisateur` (cf. `prisma/schema.prisma`). `ACTIF` à la création ;
 * `SUSPENDU` sera utilisé par la modération (ST 7.2, non développé).
 */
export type StatutUtilisateur = "ACTIF" | "SUSPENDU";

/** Longueur maximale d'une adresse e-mail (RFC 5321 : 254 caractères). */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Longueurs de mot de passe acceptées.
 * - min 12 : recommandation OWASP courante pour un mot de passe sans autre
 *   facteur ;
 * - max 128 : borne de sécurité — le hash (scrypt, cf. `lib/password.ts`)
 *   travaille sur l'entrée complète ; sans plafond, un mot de passe de
 *   plusieurs Mo transformerait chaque inscription en petit déni de service
 *   CPU.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Validation de forme d'une adresse e-mail.
 *
 * Volontairement permissive (une seule `@`, un domaine avec au moins un
 * point, pas d'espace ni de caractère de contrôle) : la seule preuve fiable
 * qu'une adresse existe est l'envoi d'un e-mail de confirmation — hors
 * périmètre ST 4.1 (cf. notes de dev). Le but ici est d'écarter les saisies
 * manifestement erronées et les chaînes hostiles (retours à la ligne pour
 * injection d'en-têtes, etc.), pas de certifier l'adresse.
 */
const EMAIL_REGEX = /^[^\s@"'<>()[\]\\,;:]+@[^\s@"'<>()[\]\\,;:]+\.[^\s@"'<>()[\]\\,;:]{2,}$/;

/** Trim + minuscule : l'e-mail est l'identifiant du compte, comparé sans casse. */
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const value = (email ?? "").trim();
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return false;
  // Un `.` en fin de domaine ou deux points consécutifs passeraient la regex
  // ci-dessus : on les écarte explicitement.
  if (value.includes("..") || value.endsWith(".") || value.startsWith(".")) return false;
  // Point collé à l'arobase, d'un côté ou de l'autre (`a.@x`, `a@.x`).
  if (value.includes(".@") || value.includes("@.")) return false;
  return EMAIL_REGEX.test(value);
}

/**
 * Diagnostic de robustesse du mot de passe.
 *
 * Règle : longueur dans [12, 128] et au moins deux natures de caractères
 * parmi { minuscule, majuscule, chiffre, autre } — un compromis entre
 * robustesse réelle et frustration utilisateur (une phrase de passe longue
 * en minuscules reste acceptée si elle atteint la longueur, une suite courte
 * type « Azerty123 » est refusée sur la longueur).
 */
export function assessPasswordStrength(password: string): string | null {
  const value = password ?? "";
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`;
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length;
  if (classes < 2) {
    return "Le mot de passe doit combiner au moins deux types de caractères (minuscules, majuscules, chiffres ou symboles).";
  }
  return null;
}

/** Données saisies au formulaire d'inscription, avant envoi. */
export interface RegistrationInput {
  email: string;
  password: string;
}

/** Erreurs de validation par champ — consommé par `RegisterForm`. */
export interface RegistrationFieldErrors {
  email?: string;
  password?: string;
}

/**
 * Valide un couple e-mail / mot de passe.
 *
 * Utilisée côté client (retour immédiat dans le formulaire) et côté serveur
 * (`registerUtilisateur` dans `lib/auth.ts`, avant tout accès base) — une
 * seule source de vérité, comme `validateScriptLigneInput` (ST 1.3) ou
 * `validateDoublageRequest` (ST 3.1).
 *
 * @returns un objet d'erreurs par champ ; `{}` si l'entrée est valide.
 */
export function collectRegistrationErrors(input: RegistrationInput): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};

  if (!input.email || !input.email.trim()) {
    errors.email = "L'adresse e-mail est requise.";
  } else if (!isValidEmail(input.email)) {
    errors.email = "Cette adresse e-mail n'est pas valide.";
  }

  if (!input.password) {
    errors.password = "Le mot de passe est requis.";
  } else {
    const weakness = assessPasswordStrength(input.password);
    if (weakness) errors.password = weakness;
  }

  return errors;
}

/** `true` si `collectRegistrationErrors` n'a rien remonté. */
export function isRegistrationInputValid(input: RegistrationInput): boolean {
  return Object.keys(collectRegistrationErrors(input)).length === 0;
}

/**
 * Information RGPD affichée sous le formulaire (cf. ST 4.1, points
 * d'attention : « informer l'utilisateur de la finalité des données
 * collectées »). Le cahier des charges (§5) laisse le détail RGPD « à
 * préciser » : ce texte est un minimum de transparence, à faire valider par
 * le porteur de projet / un juriste avant mise en production (signalé en
 * notes de dev).
 */
export const RGPD_NOTICE =
  "Votre adresse e-mail et votre mot de passe (chiffré) sont conservés uniquement " +
  "pour gérer votre compte et vous permettre de vous reconnecter. Aucune donnée " +
  "n'est transmise à des tiers à des fins commerciales.";

/** Forme publique d'un compte renvoyée par l'API — jamais le hash du mot de passe. */
export interface UtilisateurPublic {
  id: string;
  email: string;
  statut: StatutUtilisateur;
  /** Date de création ISO 8601. */
  dateCreation: string;
}
