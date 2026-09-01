/**
 * Certification des droits à l'import — ST 5.2 « Certification des droits à
 * l'import » (US 5.2 : certifier mes droits sur le contenu importé).
 *
 * Module **pur et client-safe** (aucune dépendance, ni `node:crypto` ni
 * `@prisma/client`) — même séparation que `cgu.ts` (ST 4.3) : il est importé
 * aussi bien par le futur formulaire d'import (`"use client"`, la case à
 * cocher) que par la logique serveur (`collectImportFormErrors` dans
 * `importClient.ts`, `finalizeImport` dans `import.ts`).
 *
 * Différence avec les CGU (ST 4.3) : les CGU sont acceptées **une fois par
 * compte** (garde-fou `peutImporter`) ; la certification des droits est
 * demandée **à chaque import** et **enregistrée par extrait** (horodatage +
 * version du texte), pour garder une preuve individuelle par contenu importé
 * en cas de litige (ST 5.2, « Choix techniques »).
 *
 * Contient :
 *  - `CERTIFICATION_DROITS_VERSION` : identifiant de version du texte certifié ;
 *  - `CERTIFICATION_DROITS_TEXTE` : la déclaration soumise à l'utilisateur ;
 *  - `CERTIFICATION_DROITS_CASE_LABEL` : libellé de la case à cocher ;
 *  - `CERTIFICATION_DROITS_REQUISE` : message de blocage si la case n'est pas
 *    cochée ;
 *  - `estCertificationDroitsCochee` / `erreurCertificationDroits` : validation
 *    du blocage de soumission (ST 5.2, découpage en tâches point 2).
 *
 * ⚠️ Prérequis externe (hors périmètre dev, même réserve que le texte des CGU) :
 * `CERTIFICATION_DROITS_TEXTE` est un **brouillon technique** à faire valider
 * par un juriste avant mise en production (risque juridique élevé, cahier des
 * charges §9). Toute révision de fond du texte impose d'incrémenter
 * `CERTIFICATION_DROITS_VERSION`.
 */

/**
 * Version du texte de certification actuellement soumis à l'utilisateur.
 *
 * Format date `AAAA-MM-JJ` (lisible, ordonnable), même convention que
 * `CGU_VERSION`. **Incrémenter à chaque modification de fond** du texte :
 * c'est cette valeur qui est figée dans `Extrait.certificationDroitsVersion`
 * au moment de l'import, pour savoir exactement quelle déclaration a été
 * acceptée.
 */
export const CERTIFICATION_DROITS_VERSION = "2026-09-01";

/**
 * Déclaration que l'utilisateur certifie sur l'honneur au moment de l'import.
 * Rendue telle quelle à côté de la case à cocher du formulaire d'import.
 */
export const CERTIFICATION_DROITS_TEXTE =
  "Je certifie sur l'honneur disposer des droits nécessaires sur cet extrait, " +
  "ou que son redoublage relève d'un usage amateur (« fan-dub ») sans but " +
  "lucratif autorisé par les conditions générales d'utilisation. J'assume " +
  "l'entière responsabilité de ce contenu et je m'engage à le retirer à la " +
  "demande justifiée d'un ayant droit.";

/** Libellé court de la case à cocher (formulaire d'import). */
export const CERTIFICATION_DROITS_CASE_LABEL =
  "Je certifie disposer des droits sur ce contenu (ou agir dans le cadre du fan-usage autorisé).";

/**
 * Message affiché quand la soumission d'import est bloquée faute de
 * certification cochée (ST 5.2, découpage en tâches point 2 : « Blocage de la
 * soumission d'import tant que non cochée »). Utilisé comme erreur de champ
 * par `collectImportFormErrors` (`importClient.ts`).
 */
export const CERTIFICATION_DROITS_REQUISE =
  "Vous devez certifier vos droits sur le contenu importé pour finaliser l'import.";

/**
 * `true` si la case de certification est **explicitement cochée**. Toute autre
 * valeur (`false`, `undefined`, chaîne, `null`) est considérée non cochée :
 * la certification est un acte positif, jamais implicite.
 */
export function estCertificationDroitsCochee(valeur: unknown): boolean {
  return valeur === true;
}

/**
 * Erreur de certification à afficher, ou `null` si la case est correctement
 * cochée. Renvoie un message (et non un booléen) pour que le formulaire
 * affiche directement la cause du blocage.
 */
export function erreurCertificationDroits(valeur: unknown): string | null {
  return estCertificationDroitsCochee(valeur) ? null : CERTIFICATION_DROITS_REQUISE;
}

/**
 * Trace de certification enregistrée sur un `Extrait` importé — sous-ensemble
 * des colonnes ajoutées en ST 5.2 (`prisma/schema.prisma`). `Date` (ligne
 * Prisma) ou `string` ISO / `null` accepté.
 */
export interface TraceCertificationDroits {
  certificationDroitsLe: Date | string | null;
  certificationDroitsVersion: string | null;
}

/**
 * `true` si l'extrait porte une trace de certification pour la **version
 * courante** du texte. Symétrique de `aAccepteCguActuelles` (ST 4.3) : exige
 * l'horodatage **et** la bonne version. Utile pour un futur écran de
 * modération (Epic 7) ou un audit juridique.
 */
export function aCertificationDroitsActuelle(
  trace: TraceCertificationDroits | null | undefined,
  version: string = CERTIFICATION_DROITS_VERSION
): boolean {
  if (!trace) return false;
  return (
    Boolean(trace.certificationDroitsLe) &&
    trace.certificationDroitsVersion === version
  );
}
