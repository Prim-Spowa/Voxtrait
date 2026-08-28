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

## Routes

`/` redirige systématiquement vers `/bibliotheque` (aucune page d'accueil dédiée n'est prévue) — `src/app/page.tsx`.

`NEXT_PUBLIC_SITE_URL` (optionnel) : origine publique du site, utilisée pour construire les liens de partage absolus (ST 3.2). À défaut, l'origine de la requête est utilisée.

### Pages

| Route | Description |
|---|---|
| `/bibliotheque` | Page publique de listing des extraits (grille + filtres origine/type + recherche) — ST 1.1 |
| `/admin/scripts/:extraitId` | Éditeur interne de saisie/import des lignes de script d'un extrait — ST 1.3. ⚠️ non protégé (pas d'authentification à ce stade) |
| `/doublage/:id` | Page publique de partage d'un doublage : lecteur + boutons de partage réseaux sociaux + balises Open Graph/Twitter Card. Servie uniquement si le doublage a été rendu public (`POST /api/doublages/:id/partage`), sinon 404 — ST 3.2 |
| `/dev/lecteur` | Page de QA manuelle du lecteur vidéo (`VideoPlayer`, sources EMBED/UPLOAD) — ST 1.2, `DATA_SOURCE=mock` uniquement |
| `/dev/script-sync` | Page de QA manuelle de la synchronisation script/vidéo — ST 1.3, `DATA_SOURCE=mock` uniquement |
| `/dev/enregistrement` | Page de QA manuelle de l'enregistrement vocal synchronisé (`VoiceRecorder`) + export du doublage (`DoublageExport`, y compris génération du lien de partage ST 3.2) — ST 2.1/2.2/3.1/3.2, `DATA_SOURCE=mock` uniquement |

### API

| Route | Description |
|---|---|
| `GET /api/extraits` | Liste paginée des extraits au statut `VALIDE` — filtres `origine` (FR\|US\|JP), `type` (FILM\|SERIE\|DESSIN_ANIME), `q` (recherche texte titre), `page`, `pageSize` (max 50) — ST 1.1 |
| `GET /api/extraits/:id/script` | Lignes de script d'un extrait, triées par `timestampDebut` (tableau vide si aucun script) — ST 1.3 |
| `POST /api/extraits/:id/script` | Import atomique de lignes de script — corps `{ "lignes": [{ "texte", "timestampDebut", "timestampFin" }, ...] }`. ⚠️ non protégé (pas d'authentification à ce stade) — ST 1.3 |
| `POST /api/doublages` | Crée un job de génération du fichier de doublage (vidéo + voix). Corps `multipart/form-data` (`audio`, `extraitId`, `audioDurationSeconds`, `audioOffsetSeconds?`, `mode?`) ou JSON (`audioBase64`, …). Réponse `202` `{ job }`. ⚠️ traitement FFmpeg/stockage S3 **mockés**, job exécuté inline (ni BullMQ ni Redis) — ST 3.1 |
| `GET /api/doublages/:id` | Statut d'un job de doublage (`en_attente` / `en_traitement` / `pret` / `echec`) + URL de téléchargement signée expirante quand `pret`. Polling depuis `DoublageExport` — ST 3.1 |
| `POST /api/doublages/:id/partage` | Rend un doublage `pret` partageable : visibilité → `lien_public`, renvoie `{ job }` avec `shareUrl` (page `/doublage/:id`). Idempotent. `409` si le job n'est pas prêt, `404` s'il est introuvable/expiré — ST 3.2 |

Les endpoints `GET` basculent entre Prisma/Postgres et un jeu de données mocké en mémoire selon `DATA_SOURCE` (cf. `src/lib/config.ts`).

## Upload de vidéo

Pas encore implémenté. La story technique ST 5.1 (« Import et compression vidéo », US 5.1 — importer un extrait vidéo personnel) prévoit :

- un endpoint de génération d'URL signée pour l'upload direct vers le stockage objet (pas via le serveur applicatif) ;
- une validation post-upload (durée ≤ 5 min, format, taille) ;
- un job de compression/transcodage FFmpeg asynchrone ;
- la création de l'entrée `Extrait` correspondante avec statut « en attente de modération ».

Voir [`Claude output/stories-techniques-site-doublage.md`](./Claude%20output/stories-techniques-site-doublage.md) (ST 5.1) pour le détail. Cette section du README sera complétée avec la méthode d'upload réelle (endpoint, format de requête, limites) une fois ST 5.1 développée.

Actuellement, `source: "UPLOAD"` dans le modèle `Extrait` désigne uniquement des extraits déjà hébergés (lus via `<video>` natif, cf. `VideoPlayer` — ST 1.2) ; leur ajout en base se fait pour l'instant via seed/mock, pas via un flux d'upload utilisateur.

## État du projet

Stories techniques implémentées à ce stade : ST 1.1 (bibliothèque), ST 1.2 (lecteur vidéo), ST 1.3 (synchronisation script), ST 2.1/2.2 (enregistrement vocal synchronisé + remise à zéro), ST 3.1 (génération + téléchargement du fichier de doublage — orchestration et contrats en place, briques FFmpeg/BullMQ/S3 mockées), ST 3.2 (partage réseaux sociaux : page publique `/doublage/:id`, métadonnées Open Graph, Web Share API + liens d'intent — même réserve de persistance en mémoire que ST 3.1). Voir les notes de dev dans [`Claude output/dev-note/`](./Claude%20output/dev-note/) pour le détail des décisions prises et les points en suspens (tests non exécutés en CI, migration Postgres non validée en environnement réel, endpoints admin non protégés, etc.).

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
