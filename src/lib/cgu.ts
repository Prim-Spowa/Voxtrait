/**
 * Conditions générales d'utilisation (CGU) liées à l'usage des contenus —
 * ST 4.3 « Acceptation des CGU (fan-usage) » (US 4.3 : accepter les CGU liées
 * à l'usage des contenus).
 *
 * Module **pur et client-safe** (aucune dépendance, aucun `node:crypto` ni
 * `@prisma/client`) — même séparation que `authClient.ts` (ST 4.1) : il est
 * importé aussi bien par la page `/cgu`, le formulaire d'inscription
 * (`RegisterForm`, `"use client"`) que par la logique serveur
 * (`registerUtilisateur`, endpoint `POST /api/auth/cgu`, futur flux d'import
 * ST 5.1).
 *
 * Contient :
 *  - `CGU_VERSION` : identifiant de version du texte (source de vérité) ;
 *  - le texte des CGU affiché sur la page `/cgu` ;
 *  - `aAccepteCguActuelles` : l'utilisateur a-t-il accepté la version courante ;
 *  - `peutImporter` / `raisonBlocageImport` : garde-fou d'import (ST 4.3
 *    « bloque ST 5.1 ») ;
 *  - les messages affichés au formulaire et au blocage d'import.
 *
 * ⚠️ Prérequis externe (hors périmètre dev, cf. ST 4.3 DoD) : le texte
 * ci-dessous est un **brouillon technique** ; il doit être validé par un
 * juriste avant mise en production (risque juridique élevé identifié au
 * cahier des charges §9). Toute révision juridique du texte impose de
 * changer `CGU_VERSION` pour que l'acceptation soit redemandée.
 */

/**
 * Version du texte des CGU actuellement en vigueur.
 *
 * Format date `AAAA-MM-JJ` : lisible, ordonnable, et suffisant tant qu'il n'y
 * a pas plusieurs révisions le même jour. **Incrémenter à chaque modification
 * de fond du texte** — c'est ce qui déclenche une nouvelle demande
 * d'acceptation (`aAccepteCguActuelles` compare à cette constante).
 */
export const CGU_VERSION = "2026-08-28";

/** Une section du document CGU (titre + paragraphes). */
export interface CguSection {
  titre: string;
  paragraphes: readonly string[];
}

/**
 * Corps des CGU — rendu tel quel par la page `/cgu`.
 *
 * Centré sur l'usage « fandub » : l'utilisateur reste responsable des
 * contenus qu'il importe et publie, la plateforme fournit un outil et une
 * procédure de retrait. Rédigé en clair, sans jargon inutile.
 */
export const CGU_SECTIONS: readonly CguSection[] = [
  {
    titre: "1. Objet",
    paragraphes: [
      "La plateforme permet de redoubler (« fandub ») des extraits vidéo courts : " +
        "enregistrer sa voix sur une scène, générer une vidéo doublée, la partager " +
        "ou la sauvegarder dans un espace privé.",
      "En créant un compte ou en important un contenu, vous acceptez les présentes " +
        "conditions dans leur version " +
        CGU_VERSION +
        ".",
    ],
  },
  {
    titre: "2. Usage des contenus et droits d'auteur",
    paragraphes: [
      "Les extraits originaux (films, séries, dessins animés) restent la propriété " +
        "de leurs ayants droit. La plateforme ne revendique aucun droit sur ces œuvres.",
      "Le redoublage est un usage amateur, sans but lucratif, à finalité de loisir " +
        "et de création. Il ne doit pas nuire à l'exploitation normale de l'œuvre " +
        "originale.",
      "Vous vous engagez à ne pas importer d'extrait dont la mise en ligne serait " +
        "manifestement illicite, et à retirer tout contenu à la demande justifiée " +
        "d'un ayant droit.",
    ],
  },
  {
    titre: "3. Vos responsabilités",
    paragraphes: [
      "Vous êtes seul responsable des contenus que vous importez, doublez et " +
        "publiez, ainsi que de l'usage que vous faites des vidéos générées.",
      "Vous garantissez disposer des autorisations nécessaires pour les contenus " +
        "que vous importez, ou que leur usage relève d'une exception légale " +
        "applicable.",
    ],
  },
  {
    titre: "4. Modération et retrait",
    paragraphes: [
      "Tout contenu peut être signalé. La plateforme peut retirer un contenu, sans " +
        "préavis, s'il est signalé comme illicite ou contraire aux présentes " +
        "conditions.",
      "Les ayants droit peuvent demander le retrait d'un contenu via le point de " +
        "contact dédié ; les demandes sont traitées dans les meilleurs délais.",
    ],
  },
  {
    titre: "5. Évolution des conditions",
    paragraphes: [
      "Ces conditions peuvent être mises à jour. En cas de modification de fond, " +
        "une nouvelle acceptation vous sera demandée avant de pouvoir importer un " +
        "nouveau contenu.",
    ],
  },
];

/**
 * État d'acceptation d'un utilisateur — sous-ensemble des colonnes ajoutées
 * en ST 4.3 (`prisma/schema.prisma`). Accepte `Date` (ligne Prisma) ou
 * `string` ISO / `null` (forme publique `UtilisateurPublic`).
 */
export interface EtatAcceptationCgu {
  cguAccepteesLe: Date | string | null;
  cguVersionAcceptee: string | null;
}

/**
 * `true` si l'utilisateur a accepté la **version courante** des CGU.
 *
 * Exige les deux : un horodatage d'acceptation **et** une version qui
 * correspond à `CGU_VERSION`. Un compte ayant accepté une version antérieure
 * (`cguVersionAcceptee` différent) doit ré-accepter — c'est l'intérêt du
 * versionnement (ST 4.3, « Choix techniques »).
 */
export function aAccepteCguActuelles(
  etat: EtatAcceptationCgu | null | undefined,
  version: string = CGU_VERSION
): boolean {
  if (!etat) return false;
  return Boolean(etat.cguAccepteesLe) && etat.cguVersionAcceptee === version;
}

/**
 * Message affiché quand l'import est bloqué faute d'acceptation des CGU
 * (ST 4.3 « bloque ST 5.1 »). Utilisé par le futur flux d'import (ST 5.1) et
 * par les tests de blocage (DoD ST 4.3).
 */
export const MESSAGE_IMPORT_CGU_REQUISES =
  "Vous devez accepter les conditions générales d'utilisation avant d'importer un contenu.";

/**
 * `true` si l'utilisateur est autorisé à importer un contenu personnel
 * (ST 5.1) du point de vue des CGU. Garde-fou métier réutilisable côté
 * serveur, indépendamment du contrôle de session (ST 4.2) et de la
 * certification des droits par import (ST 5.2).
 */
export function peutImporter(etat: EtatAcceptationCgu | null | undefined): boolean {
  return aAccepteCguActuelles(etat);
}

/**
 * Raison du blocage d'import, ou `null` si l'import est autorisé.
 * Renvoyer un message (et non un simple booléen) permet au flux d'import
 * d'afficher directement la cause à l'utilisateur.
 */
export function raisonBlocageImport(
  etat: EtatAcceptationCgu | null | undefined
): string | null {
  return peutImporter(etat) ? null : MESSAGE_IMPORT_CGU_REQUISES;
}

/**
 * Message d'erreur du formulaire d'inscription quand la case CGU n'est pas
 * cochée (`RegisterForm`, `collectRegistrationErrors`).
 */
export const CGU_ACCEPTATION_REQUISE =
  "Vous devez accepter les conditions générales d'utilisation pour créer un compte.";

/** Libellé de la case à cocher d'acceptation (formulaire d'inscription). */
export const CGU_CASE_LABEL =
  "J'ai lu et j'accepte les conditions générales d'utilisation.";
