/**
 * Garde-fou d'environnement pour `prisma/seed.ts` — ST 10.5 « Clarification
 * du contenu affiché dans la bibliothèque (jeu de démonstration) »,
 * découpage en tâches point 1 : « Conditionner l'exécution de
 * `prisma/seed.ts` à l'environnement (jamais lancé automatiquement en
 * production) ».
 *
 * Contexte (cf. notes de dev ST 10.5) : aucun pipeline de déploiement en
 * production n'existe encore dans ce dépôt (seul `.github/workflows/ci.yml`,
 * qui seede une base Postgres de **test** éphémère) et ni `npm run build` ni
 * `npm start` n'invoquent `db:seed` — le jeu de données de démonstration
 * n'est donc, à ce stade, jamais injecté automatiquement en production. Ce
 * garde-fou ajoute une seconde ligne de défense, au cas où le script serait
 * un jour lancé manuellement (ou par un futur pipeline) avec
 * `NODE_ENV=production` : même posture que `getRedisUrl`
 * (`src/lib/media/redisConnection.ts`) / `getMediaUrlSecret`
 * (`src/lib/media/mediaUrlSigning.ts`) — échec explicite plutôt qu'un jeu de
 * données fictif injecté silencieusement dans une base réelle.
 *
 * Échappatoire volontaire (`ALLOW_PRODUCTION_SEED=true`) pour un
 * environnement de démo/recette légitimement configuré avec
 * `NODE_ENV=production` (cf. cahier des charges — aucun environnement de ce
 * type n'existe à ce jour dans ce dépôt) sans bloquer la commande à double
 * confirmation explicite plutôt qu'un contournement implicite.
 */

const OVERRIDE_ENV_VAR = "ALLOW_PRODUCTION_SEED";

export class SeedProductionGuardError extends Error {
  constructor() {
    super(
      "Seed refusé : NODE_ENV=production. Le jeu de données de démonstration " +
        "(prisma/seed.ts) ne doit pas être injecté dans une base de " +
        `production (cf. ST 10.5). Pour un environnement de démo/recette ` +
        `légitimement en NODE_ENV=production, positionner ${OVERRIDE_ENV_VAR}=true.`
    );
    this.name = "SeedProductionGuardError";
  }
}

/**
 * Lève `SeedProductionGuardError` si l'exécution a lieu en production sans
 * l'échappatoire explicite. Ne fait rien (retour silencieux) sinon —
 * appelée en tête de `main()` dans `prisma/seed.ts`, avant toute écriture en
 * base.
 */
export function assertSeedAllowed(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | typeof OVERRIDE_ENV_VAR>> = process.env
): void {
  const isProduction = env.NODE_ENV === "production";
  const overridden = env[OVERRIDE_ENV_VAR] === "true";
  if (isProduction && !overridden) {
    throw new SeedProductionGuardError();
  }
}
