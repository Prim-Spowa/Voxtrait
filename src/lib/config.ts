/**
 * Configuration centrale de la source de données de l'application.
 *
 * ⚠️ Périmètre réduit depuis ST 9.1 (« Bascule intégrale sur PostgreSQL »,
 * cf. `stories-techniques-site-doublage.md`) : la bascule `DATA_SOURCE=mock`
 * a été retirée des endpoints de lecture couverts par cette story
 * (`GET /api/extraits`, `GET /api/extraits/:id/script`, `GET /api/doublages`,
 * `GET /api/admin/moderation`, `GET /api/admin/demandes-retrait`, et les
 * stores/gateways dont ils dépendent, cf. `src/lib/mocks/*.mock.ts`) — ces
 * endpoints interrogent désormais toujours Prisma/Postgres, y compris en
 * développement local (jeu de données de démonstration injecté par
 * `prisma/seed.ts`, cf. README).
 *
 * `DATA_SOURCE` reste utilisé ailleurs dans le projet — notamment
 * l'authentification (`POST /api/auth/*`, `src/lib/importAuth.ts`,
 * `src/lib/moderationAuth.ts`) et l'import (`POST /api/import`) — dont la
 * bascule complète vers Postgres/un stockage réel reste hors périmètre de
 * ST 9.1. Sert aussi, depuis ST 9.4, à choisir entre l'implémentation en
 * mémoire et l'implémentation Redis du store de sessions
 * (`lib/sessionStore.ts`) et du rate limiting (`lib/rateLimiterFactory.ts`).
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
