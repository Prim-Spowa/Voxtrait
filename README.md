# Voxtrait

Site web permettant de parcourir une bibliothèque d'extraits vidéo (films, séries, dessins animés FR/US/JP) et de les redoubler pour le plaisir, dans un cadre créatif et non commercial.

Voir [`Claude output/cahier-des-charges-site-doublage.md`](./Claude%20output/cahier-des-charges-site-doublage.md) pour le contexte fonctionnel complet, [`Claude output/user-stories-site-doublage.md`](./Claude%20output/user-stories-site-doublage.md) et [`Claude output/stories-techniques-site-doublage.md`](./Claude%20output/stories-techniques-site-doublage.md) pour le détail produit et technique.

## Stack

- [Next.js 14](https://nextjs.org/) (App Router) + React 18 + TypeScript
- [Prisma](https://www.prisma.io/) + PostgreSQL (recherche texte via extension `pg_trgm`)
- [Vitest](https://vitest.dev/) + Testing Library pour les tests unitaires et de composants

## Prérequis

- Node.js 20+
- Une base PostgreSQL accessible (locale ou distante)

## Installation

```bash
npm install
cp .env.example .env
# renseigner DATABASE_URL dans .env
npx prisma migrate dev
```

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Démarre le serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Démarre le serveur de production (après build) |
| `npm run lint` | Lint du projet |
| `npm test` | Lance la suite de tests |
| `npm run test:watch` | Lance les tests en mode watch |
| `npm run prisma:generate` | Génère le client Prisma |
| `npm run prisma:migrate` | Applique les migrations Prisma en dev |

## État du projet

Seule la première story technique (ST 1.1 — bibliothèque d'extraits) est implémentée à ce stade :

- Modèle Prisma `Extrait` (`prisma/schema.prisma`)
- Endpoint `GET /api/extraits` (filtres origine/type, recherche texte, pagination) — `src/app/api/extraits/route.ts`
- Page publique `/bibliotheque` (grille + filtres) — `src/app/bibliotheque/page.tsx`

Voir [`dev-notes-ST-1.1.md`](./dev-notes-ST-1.1.md) pour le détail des décisions prises et les points en suspens (tests non exécutés en CI, migration Postgres non validée en environnement réel, etc.).

## Structure du projet

```
src/
  app/            # Pages et routes API (App Router)
  components/     # Composants React
  lib/            # Logique métier (testable indépendamment de Next.js)
  types/          # Types partagés
prisma/
  schema.prisma   # Modèle de données
  migrations/     # Migrations SQL
```
