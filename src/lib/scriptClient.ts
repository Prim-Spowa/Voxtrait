/**
 * Logique client-safe de la synchronisation script/dialogue (ST 1.3
 * "Synchronisation script/dialogue").
 *
 * Séparée de `lib/script.ts` (qui importe des types `@prisma/client`) pour
 * pouvoir être importée depuis des composants "use client"
 * (`ScriptSynchronise`, outil admin) sans faire entrer le client Prisma dans
 * le bundle navigateur — même séparation que `types/extrait.ts` /
 * `lib/extraitsClient.ts` vis-à-vis de `lib/extraits.ts` pour ST 1.1.
 */

/** Bornes temporelles d'une ligne de script, en secondes. */
export interface ScriptLigneTiming {
  timestampDebut: number;
  timestampFin: number;
}

/**
 * Résout l'index de la ligne "active" à un instant donné.
 *
 * Contrat : une ligne est active sur l'intervalle [timestampDebut,
 * timestampFin) — borne de début incluse, borne de fin exclue, pour qu'à
 * l'instant exact de transition entre deux répliques une seule ligne soit
 * active à la fois. Retourne -1 si aucune ligne ne couvre `time` (avant la
 * première réplique, ou dans un silence entre deux répliques) : ce n'est pas
 * une erreur, l'appelant (`ScriptSynchronise`) doit alors n'afficher aucune
 * surbrillance plutôt que de retomber sur la dernière ligne connue.
 *
 * Les lignes ne sont pas re-triées ici : l'appelant est responsable de
 * fournir des lignes déjà ordonnées par `timestampDebut` croissant (cf.
 * `listScriptLignes` dans `lib/script.ts`, qui trie à la lecture) — le
 * résultat n'est pas garanti sinon (seule la première ligne dont
 * l'intervalle couvre `time` est retournée, dans l'ordre du tableau fourni).
 */
export function resolveActiveLineIndex(
  lines: readonly ScriptLigneTiming[],
  time: number
): number {
  return lines.findIndex((line) => time >= line.timestampDebut && time < line.timestampFin);
}

/** Ligne de script saisie/importée, avant persistance (pas encore d'id). */
export interface ScriptLigneInput {
  texte: string;
  timestampDebut: number;
  timestampFin: number;
}

/**
 * Valide une ligne de script saisie/importée par l'outil interne (admin,
 * cf. ST 1.3, découpage en tâches, point 4).
 *
 * Retourne un message d'erreur utilisateur si la ligne est invalide, `null`
 * sinon. Utilisée à la fois côté client (retour immédiat dans le formulaire
 * admin) et côté serveur (`parseScriptLignesPayload` dans `lib/script.ts`,
 * avant écriture en base) — une seule source de vérité pour les règles de
 * validation.
 *
 * Règles :
 * - texte non vide après trim (une réplique vide ne peut pas être affichée
 *   par `ScriptSynchronise`) ;
 * - timestamps finis et positifs ou nuls ;
 * - `timestampFin` strictement supérieur à `timestampDebut` : un intervalle
 *   nul ou négatif ne serait jamais actif (cf. `resolveActiveLineIndex`,
 *   demi-ouvert [debut, fin)), ce qui rendrait la ligne invisible en silence
 *   plutôt que de lever une erreur explicite à la saisie.
 */
export function validateScriptLigneInput(input: ScriptLigneInput): string | null {
  if (!input.texte || !input.texte.trim()) {
    return "Le texte de la réplique est requis.";
  }
  if (!Number.isFinite(input.timestampDebut) || input.timestampDebut < 0) {
    return "Le timestamp de début doit être un nombre positif ou nul.";
  }
  if (!Number.isFinite(input.timestampFin) || input.timestampFin < 0) {
    return "Le timestamp de fin doit être un nombre positif ou nul.";
  }
  if (input.timestampFin <= input.timestampDebut) {
    return "Le timestamp de fin doit être strictement supérieur au timestamp de début.";
  }
  return null;
}
