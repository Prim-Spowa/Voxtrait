# Tests de bout en bout (Playwright) — ST 11.3

## Prérequis

```bash
docker compose up -d          # Postgres + Redis + MinIO
npm ci
npx playwright install --with-deps chromium
DATABASE_URL=".../fandub_test?schema=public" npx prisma migrate deploy
DATABASE_URL=".../fandub_test?schema=public" npm run db:seed
```

L'environnement est fourni par `.env.test` (chargé automatiquement par
`playwright.config.ts`).

## Lancer

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # mode interactif
```

Le serveur applicatif est démarré automatiquement par Playwright sur le port
`3100` (variable `E2E_PORT`).

## Périmètre des scénarios

| Fichier | Parcours | État |
|---|---|---|
| `bibliotheque.spec.ts` | Bibliothèque (filtres origine/type, recherche) → `/extraits/:id` → bouton d'export visible | ✅ actif |
| `auth.spec.ts` | Inscription → session connectée → déconnexion | ✅ actif |
| `import.spec.ts` | Import + certification des droits (worker requis) | ⏳ `test.fixme` — cf. dev-note ST 11.3 |
| `espace-prive.spec.ts` | Favoris / historique → doublage (ST 11.2) | ⏳ `test.fixme` |
| `moderation.spec.ts` | Signalement → dashboard de modération | ⏳ `test.fixme` |
| `retrait.spec.ts` | Demande de retrait → rapport des délais | ⏳ `test.fixme` |

Les scénarios `test.fixme` sont scaffoldés (sélecteurs et étapes esquissés)
mais désactivés : ils dépendent d'un compte modérateur seedé et/ou du worker
BullMQ, dont l'outillage de fixtures E2E reste à cadrer (réunion technique,
cf. `Claude output/dev-note/dev-notes-ST11.3-env-dev-test.md`).
