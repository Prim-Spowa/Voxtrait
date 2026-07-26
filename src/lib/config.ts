/**
 * Configuration centrale de la source de données de l'application.
 *
 * Permet de basculer entre données réelles (Prisma/Postgres) et données
 * mockées en mémoire, sans toucher au code métier ni aux composants
 * consommateurs — les deux sources respectent le même contrat
 * (`ExtraitDelegate`, cf. `lib/extraits.ts`).
 *
 * Usage : définir `DATA_SOURCE=mock` (fichier `.env` ou variable
 * d'environnement au lancement) pour développer/tester ST 1.1 (bibliothèque)
 * et ST 1.2 (lecteur vidéo) sans base Postgres ni contenu réel importé. Voir
 * `.env.example` et `src/lib/mocks/`.
 *
 * Par défaut (variable absente ou invalide) : "api", le comportement de
 * production — aucune régression si `DATA_SOURCE` n'est pas positionnée.
 */

export type DataSource = "api" | "mock";

const VALID_SOURCES: readonly DataSource[] = ["api", "mock"];

/**
 * Lit `DATA_SOURCE` depuis l'environnement à chaque appel (pas de valeur mise
 * en cache au chargement du module) : utile pour les tests qui basculent la
 * variable via `vi.stubEnv` / affectation directe de `process.env` en cours
 * d'exécution.
 *
 * Une valeur non reconnue retombe silencieusement sur "api" plutôt que de lever
 * une erreur — une faute de frappe dans `.env` ne doit pas empêcher le serveur
 * de démarrer, seulement lui faire perdre le mode mock.
 */
export function getDataSource(): DataSource {
  const raw = process.env.DATA_SOURCE?.trim().toLowerCase();
  return (VALID_SOURCES as readonly string[]).includes(raw ?? "")
    ? (raw as DataSource)
    : "api";
}

export function isMockDataSource(): boolean {
  return getDataSource() === "mock";
}
