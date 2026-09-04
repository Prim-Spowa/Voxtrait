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

`AUTH_SESSION_SECRET` : secret de signature des jetons de session (ST 4.1). **Obligatoire en production** (≥ 32 caractères) ; hors production, un secret de développement non sûr est utilisé par défaut.

> Après un `git pull` modifiant `prisma/schema.prisma`, régénérer le client : `npx prisma generate` (les modèles `Utilisateur` — ST 4.1 — et `Doublage` — ST 6.1 — en dépendent). Sous Windows, arrêter d'abord le serveur `next dev`, qui verrouille le moteur de requêtes Prisma.

### Pages

| Route | Description |
|---|---|
| `/bibliotheque` | Page publique de listing des extraits (grille + filtres origine/type + recherche) — ST 1.1 |
| `/admin/scripts/:extraitId` | Éditeur interne de saisie/import des lignes de script d'un extrait — ST 1.3. ⚠️ non protégé (pas d'authentification à ce stade) |
| `/doublage/:id` | Page publique de partage d'un doublage : lecteur + boutons de partage réseaux sociaux + balises Open Graph/Twitter Card. Servie uniquement si le doublage a été rendu public (`POST /api/doublages/:id/partage`), sinon 404 — ST 3.2 |
| `/inscription` | Formulaire de création de compte (e-mail + mot de passe). À la création, l'utilisateur est connecté (cookie de session `httpOnly`) — ST 4.1 |
| `/dev/lecteur` | Page de QA manuelle du lecteur vidéo (`VideoPlayer`, sources EMBED/UPLOAD) — ST 1.2, `DATA_SOURCE=mock` uniquement |
| `/dev/script-sync` | Page de QA manuelle de la synchronisation script/vidéo — ST 1.3, `DATA_SOURCE=mock` uniquement |
| `/dev/enregistrement` | Page de QA manuelle de l'enregistrement vocal synchronisé (`VoiceRecorder`) + export du doublage (`DoublageExport`, y compris génération du lien de partage ST 3.2) — ST 2.1/2.2/3.1/3.2, `DATA_SOURCE=mock` uniquement |
| `/mon-espace/historique` | Historique des doublages sauvegardés du compte connecté : liste paginée avec, par doublage, rejouer (lecteur inline), télécharger (fichier déjà généré) et partager. Route réservée aux comptes (middleware `/mon-espace/*`) — ST 6.2 |

### API

| Route | Description |
|---|---|
| `GET /api/extraits` | Liste paginée des extraits au statut `VALIDE` — filtres `origine` (FR\|US\|JP), `type` (FILM\|SERIE\|DESSIN_ANIME), `q` (recherche texte titre), `page`, `pageSize` (max 50) — ST 1.1 |
| `GET /api/extraits/:id/script` | Lignes de script d'un extrait, triées par `timestampDebut` (tableau vide si aucun script) — ST 1.3 |
| `POST /api/extraits/:id/script` | Import atomique de lignes de script — corps `{ "lignes": [{ "texte", "timestampDebut", "timestampFin" }, ...] }`. ⚠️ non protégé (pas d'authentification à ce stade) — ST 1.3 |
| `POST /api/doublages` | Crée un job de génération du fichier de doublage (vidéo + voix). Corps `multipart/form-data` (`audio`, `extraitId`, `audioDurationSeconds`, `audioOffsetSeconds?`, `mode?`) ou JSON (`audioBase64`, …). Réponse `202` `{ job }`. ⚠️ traitement FFmpeg/stockage S3 **mockés**, job exécuté inline (ni BullMQ ni Redis) — ST 3.1 |
| `GET /api/doublages/:id` | Statut d'un job de doublage (`en_attente` / `en_traitement` / `pret` / `echec`) + URL de téléchargement signée expirante quand `pret`. Polling depuis `DoublageExport` — ST 3.1 |
| `POST /api/doublages/:id/partage` | Rend un doublage `pret` partageable : visibilité → `lien_public`, renvoie `{ job }` avec `shareUrl` (page `/doublage/:id`). Idempotent. `409` si le job n'est pas prêt, `404` s'il est introuvable/expiré — ST 3.2 |
| `POST /api/doublages/:id/sauvegarder` | Lie le doublage généré `:id` (job `pret`) au compte connecté, **visibilité privée par défaut** (pas de re-génération : l'URL du fichier est recopiée du job). `201` `{ sauvegarde }` (ou `200` si déjà sauvegardé — idempotent) ; `401` (session absente), `404` (job introuvable/expiré), `409` (doublage pas encore prêt). Seul le propriétaire peut relire un doublage privé (`lireDoublageSauvegarde`) — ST 6.1 |
| `GET /api/doublages?utilisateur=me` | Historique paginé des doublages **sauvegardés** du compte connecté, les plus récents d'abord, chaque entrée enrichie du titre/vignette de l'extrait d'origine. Query : `utilisateur=me` (obligatoire), `page`, `pageSize` (défaut 12, max 50). `200` `{ items, pagination }` ; `400` (query invalide), `401` (session absente) — ST 6.2 |
| `POST /api/auth/register` | Crée un compte — corps JSON `{ "email", "password" }`. `201` `{ utilisateur }` + cookie de session `httpOnly` ; `400` (entrée invalide, `fieldErrors`), `409` (e-mail déjà utilisé), `429` (rate limiting par IP : 5 / 10 min). Mot de passe haché (scrypt). ⚠️ rate limiting et store de session **en mémoire par process** — ST 4.1 |
| `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/session` | Connexion, déconnexion, lecture de l'état de session — ST 4.2 |
| `POST /api/auth/cgu` | Enregistre l'acceptation de la version courante des CGU par l'utilisateur connecté — ST 4.3 |
| `POST /api/import/upload-url` | Génère une URL d'upload signée pour l'import d'une vidéo personnelle — corps JSON `{ "filename", "contentType", "sizeBytes" }`. `200` `{ upload }` ; `400` (format/taille), `401`/`403` (session / CGU non acceptées), `429` (20 / 10 min par IP). Réservé aux comptes ayant accepté les CGU. ⚠️ URL signée **mockée** (pas de client S3) — ST 5.1 |
| `POST /api/import` | Finalise un import : valide la vidéo uploadée (durée ≤ 5 min, format, taille), lance la compression FFmpeg et crée l'entrée `Extrait` au statut `EN_ATTENTE`. Corps JSON `{ "objectRef", "titre", "origine", "type", "certifieDroits": true }` (durée sondée côté serveur ; `certifieDroits` = case de certification des droits, obligatoire — ST 5.2). `202` `{ job }` ; `400` (dont `fieldErrors.certifieDroits` si non cochée), `401`/`403`, `404` (fichier absent), `422` (vidéo non conforme — **fichier supprimé du stockage**). ⚠️ sonde/compression/stockage **mockés**, job exécuté inline — ST 5.1 / 5.2 |
| `GET /api/import/:id` | Statut d'un job d'import (`en_attente` / `en_traitement` / `pret` / `echec`) + `extraitId` quand `pret`. Réservé au propriétaire du job (`404` sinon). Polling — ST 5.1 |

Les endpoints `GET` basculent entre Prisma/Postgres et un jeu de données mocké en mémoire selon `DATA_SOURCE` (cf. `src/lib/config.ts`).

## Upload de vidéo

Orchestration et contrats en place (ST 5.1 « Import et compression vidéo », US 5.1). Flux en trois temps, réservé aux comptes ayant accepté les CGU (ST 4.2 + ST 4.3) :

1. `POST /api/import/upload-url` → URL d'upload signée (validation du format et de la taille **déclarés**).
2. Le client PUT le fichier directement vers cette URL (stockage objet, pas via l'API applicative).
3. `POST /api/import` → sonde de la vidéo réelle (`ffprobe`), **validation post-upload** (durée ≤ 5 min **stricte**, format, taille — un fichier non conforme est supprimé du stockage immédiatement), job de compression FFmpeg (transcodage MP4 H.264/AAC ≤ 720p), puis création de l'entrée `Extrait` (`source = UPLOAD`, `statut = EN_ATTENTE`). Suivi par polling sur `GET /api/import/:id`.

Limites : durée ≤ 5 min (`MAX_IMPORT_DURATION_SECONDS`), taille ≤ 500 Mo, formats MP4 / MOV / WebM / MKV (cf. `src/lib/importClient.ts`).

**Certification des droits (ST 5.2)** — l'étape 3 exige `certifieDroits: true` (case à cocher du futur formulaire d'import). Sans elle, `POST /api/import` répond `400` sans rien écrire et le fichier uploadé est nettoyé. Quand elle est cochée, l'horodatage et la version du texte certifié (`CERTIFICATION_DROITS_VERSION`, `src/lib/certificationDroits.ts`) sont enregistrés **sur l'`Extrait`** (`certificationDroitsLe` / `certificationDroitsVersion`) — preuve individuelle par import, distincte de l'acceptation des CGU (ST 4.3, unique par compte). Texte à faire valider par un juriste avant production.

⚠️ **Périmètre** — même posture que ST 3.1 : le client S3, `ffprobe`, FFmpeg et la file de jobs (BullMQ/Redis) ne sont **pas installés**. Les endpoints utilisent des adaptateurs **mockés** (`src/lib/mocks/import.mock.ts`) et le job est exécuté **inline**. Le branchement des vraies briques se fait en fournissant d'autres implémentations des interfaces de `src/lib/import.ts` (`SignedUploadUrlIssuer`, `UploadedVideoProbe`, `VideoCompressor`, `ObjectStorageCleaner`, `ExtraitLibraryWriter`), sans toucher au reste du code. Voir les notes de dev ST 5.1.

Le **formulaire d'import** (`/import`, déjà réservé par le middleware ST 4.2) et l'upload côté navigateur ne sont pas encore développés — signalés comme points en suspens (ST 5.1 ne découpe que le backend).

## État du projet

Stories techniques implémentées à ce stade : ST 1.1 (bibliothèque), ST 1.2 (lecteur vidéo), ST 1.3 (synchronisation script), ST 2.1/2.2 (enregistrement vocal synchronisé + remise à zéro), ST 3.1 (génération + téléchargement du fichier de doublage — orchestration et contrats en place, briques FFmpeg/BullMQ/S3 mockées), ST 3.2 (partage réseaux sociaux : page publique `/doublage/:id`, métadonnées Open Graph, Web Share API + liens d'intent — même réserve de persistance en mémoire que ST 3.1), ST 4.1 (inscription : `/inscription` + `POST /api/auth/register`, validation partagée client/serveur, hachage scrypt, cookie de session émis — hachage argon2, vérification de session/middleware et persistance du rate limiting restant à brancher, cf. notes de dev), ST 4.2 (connexion/déconnexion + middleware), ST 4.3 (acceptation des CGU), ST 5.1 (import et compression vidéo — endpoints, validation post-upload durée/format/taille, machine à états du job de compression, création de l'`Extrait` EN_ATTENTE ; briques S3/`ffprobe`/FFmpeg mockées, job inline, formulaire d'import à faire — cf. notes de dev), ST 5.2 (certification des droits à l'import — case obligatoire bloquant la finalisation, preuve horodatée + versionnée enregistrée par extrait). Voir les notes de dev dans [`Claude output/dev-note/`](./Claude%20output/dev-note/) pour le détail des décisions prises et les points en suspens (tests non exécutés en CI, migration Postgres non validée en environnement réel, endpoints admin non protégés, etc.).

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
