# Voxtrait

Site web permettant de parcourir une bibliothèque d'extraits vidéo (films, séries, dessins animés FR/US/JP) et de les redoubler pour le plaisir, dans un cadre créatif et non commercial.

Voir [`Claude output/cahier-des-charges-site-doublage.md`](./Claude%20output/cahier-des-charges-site-doublage.md) pour le contexte fonctionnel complet, [`Claude output/user-stories-site-doublage.md`](./Claude%20output/user-stories-site-doublage.md) et [`Claude output/stories-techniques-site-doublage.md`](./Claude%20output/stories-techniques-site-doublage.md) pour le détail produit et technique.

## Stack

- [Next.js 14](https://nextjs.org/) (App Router) + React 18 + TypeScript
- [Prisma](https://www.prisma.io/) + PostgreSQL (recherche texte via extension `pg_trgm`)
- [Vitest](https://vitest.dev/) + Testing Library pour les tests unitaires et de composants

## Prérequis

- Node.js 20+
- Docker (Docker Compose v2) — fournit PostgreSQL, Redis et MinIO en local via `docker compose up -d`. Développeur sans Docker : voir « Sans Docker » ci-dessous.
- FFmpeg (fournit aussi `ffprobe`) installé et accessible sur le `PATH` (ST 9.3, traitement vidéo réel) — sinon `FFMPEG_PATH`/`FFPROBE_PATH` dans `.env`. **Prérequis binaire hors Docker** : l'application (`npm run dev`) et le worker (`npm run worker`) tournent sur la machine hôte, pas dans un conteneur. Installation : `apt-get install ffmpeg` (Debian/Ubuntu), `brew install ffmpeg` (macOS), [ffmpeg.org/download.html](https://ffmpeg.org/download.html) (Windows)

## Installation

Depuis un `checkout` vierge :

```bash
docker compose up -d          # PostgreSQL + Redis + MinIO (+ bucket fandub-dev)
npm ci
cp .env.example .env          # valeurs par défaut alignées sur docker-compose.yml
npm run dev:setup             # prisma migrate dev + db:seed + contrôle des services
npm run dev                   # http://localhost:3000
npm run worker                # (autre terminal) requis hors DATA_SOURCE=mock
```

`npm run dev:setup` (ST 11.3) applique les migrations, injecte le jeu de données de démonstration et affiche l'état des services (`docker-compose.yml`) et des binaires FFmpeg/ffprobe.

### Démontage

```bash
npm run dev:reset             # prisma migrate reset + docker compose down -v
```

`docker compose down` arrête les services en conservant les volumes ; `-v` supprime aussi les données (Postgres, MinIO).

### Sans Docker

Fournir une instance PostgreSQL, Redis et un stockage S3 par vos propres moyens, puis surcharger dans `.env` : `DATABASE_URL`, `REDIS_URL`, et les variables `S3_*` (cf. `.env.example`). Le reste de la procédure (`npm ci`, `npm run dev:setup`, `npm run dev`) est identique.

### Mode dégradé `DATA_SOURCE=mock`

`DATA_SOURCE=mock` dans `.env` fait tourner l'authentification et l'import sur des adaptateurs mockés, sans MinIO ni FFmpeg ni worker (les jobs sont traités inline). La bibliothèque, l'historique, la modération et les demandes de retrait interrogent toujours Postgres (ST 9.1) — `docker compose up -d postgres` et `npm run db:seed` restent nécessaires.

`npm run db:seed` (ST 9.1) injecte un jeu de données de **démonstration** (dev/démo) — extraits (bibliothèque, ST 1.1) et lignes de script (ST 1.3) — équivalent à l'ancien mode `DATA_SOURCE=mock`, mais dans la vraie base Postgres locale. Script idempotent (`prisma/seed.ts`), à relancer sans risque après un `prisma migrate reset`. Ce jeu de données de démonstration reste **distinct du contenu réel** (import utilisateur via ST 5.1/9.5, validé en modération via l'Epic 7) : ses extraits portent le même statut de modération (`StatutModeration` — `VALIDE`/`EN_ATTENTE`/`REJETE`) qu'un contenu réel obtiendrait, sans traitement de faveur (ST 10.5). Aucun pipeline de déploiement en production n'existe à ce jour dans ce dépôt et ni `npm run build` ni `npm start` n'invoquent `db:seed` — mais par sécurité, le script refuse par défaut de s'exécuter avec `NODE_ENV=production` (`assertSeedAllowed`, [`src/lib/seedGuard.ts`](./src/lib/seedGuard.ts)), échappatoire explicite `ALLOW_PRODUCTION_SEED=true` pour un futur environnement de démo légitimement en `NODE_ENV=production` — ST 10.5.

Le service `minio` de `docker-compose.yml` (ST 9.2, consolidé par ST 11.3) démarre un MinIO local (compatible S3) sur `http://localhost:9000`, avec le bucket `fandub-dev` créé automatiquement (service `minio-init`) — identifiants et bucket déjà alignés avec le repli par défaut de `getObjectStorageConfig` (`src/lib/objectStorage.ts`), donc rien à ajouter dans `.env` pour développer en local. Console web : `http://localhost:9001` (`minioadmin` / `minioadmin`). Sans ce service, les endpoints d'import (`POST /api/import/upload-url`, `POST /api/import`) et de génération du doublage (`POST /api/doublages`) échoueront en essayant de joindre le stockage réel — sauf en mode `DATA_SOURCE=mock` (adaptateurs mockés, sans dépendance à MinIO).

## Tests

```bash
npm test          # suite complète (Vitest) — inclut les 3 tests à corriger
npm run test:ci   # suite de la CI — exclut ces 3 tests (cf. ci-dessous)
npm run test:e2e  # parcours de bout en bout (Playwright) — voir e2e/README.md
```

Les tests chargent `.env.test` (versionné, base `fandub_test`, secrets de test), source unique partagée local / CI. La base de test et les services doivent être disponibles : `docker compose up -d`, puis `DATABASE_URL` de `.env.test` migrée et seedée (`cp .env.test .env && npx prisma migrate deploy && npm run db:seed`, ou base `fandub_test` dédiée).

`npm run test:ci` exclut 3 fichiers dont l'échec est préexistant et documenté (`VideoPlayer.test.tsx`, `VoiceRecorder.test.tsx`, `AdminScriptEditorClient.test.tsx`) — liste et tickets de suivi datés dans [`vitest.config.ts`](./vitest.config.ts) (`KNOWN_FAILING`) et [`Claude output/dev-note/dev-notes-ST11.3-env-dev-test.md`](./Claude%20output/dev-note/dev-notes-ST11.3-env-dev-test.md). Objectif : `npm test` ≡ `npm run test:ci`.

Les E2E Playwright couvrent aujourd'hui la bibliothèque → extrait → export et l'inscription/déconnexion ; les parcours import, favoris/historique, modération et demande de retrait sont scaffoldés (`test.fixme`) en attendant l'outillage de fixtures — voir [`e2e/README.md`](./e2e/README.md).

## Tester les fonctionnalités

Mode d'emploi permettant à un nouveau contributeur de **valider manuellement** chaque fonctionnalité livrée (ST 1.1 → 11.3). Chaque procédure indique : *objectif · point de départ · étapes · résultat attendu · test automatisé correspondant*. Le détail des décisions et des limites connues est dans les notes de dev ([`Claude output/dev-note/`](./Claude%20output/dev-note/)) — cette section n'en reprend que le parcours de validation.

> Cette section fait partie de la Definition of Done : toute nouvelle story doit y ajouter (ou y mettre à jour) sa procédure de test — cf. `Claude output/stories-techniques-site-doublage.md`, ST 11.4.

### Prérequis de test

```bash
docker compose up -d                       # Postgres + Redis + MinIO (+ bucket)
npm ci
cp .env.example .env
npm run dev:setup                          # migrations + jeu de démonstration (db:seed)
npm run dev                                # http://localhost:3000
npm run worker                             # autre terminal — requis hors DATA_SOURCE=mock
```

- **Jeu de démonstration** (`npm run db:seed`, ST 9.1) : 24 extraits `VALIDE`, 3 `EN_ATTENTE`, 2 `REJETE`. Repères utiles : `mock-001` (« L'Odyssée Stellaire — Pilote », origine FR, source **EMBED**, **seul extrait doté d'un script**), `mock-002` (« Réverbérations », origine US, source **UPLOAD**, sans script). Script idempotent, rejouable après `npm run dev:reset`.
- **Compte modérateur** : aucune interface ne promeut un compte. Créez un compte via `/inscription`, puis en base :
  ```sql
  UPDATE utilisateurs SET role = 'MODERATEUR' WHERE email = 'vous@example.com';
  ```
- **Second compte standard** : créez-en un deuxième pour les parcours multi-utilisateurs (contrôle d'accès propriétaire d'un doublage, signalement du contenu d'autrui).
- **Parcours dégradé** : `DATA_SOURCE=mock` dans `.env` fait tourner authentification et import sur des adaptateurs mockés, **sans MinIO / FFmpeg / worker** (jobs traités inline). La bibliothèque, l'historique, la modération et les demandes de retrait interrogent toujours Postgres — `docker compose up -d postgres` + `npm run db:seed` restent nécessaires. Les procédures ci-dessous décrivent le **parcours réel** ; les écarts en mode mock sont signalés au cas par cas.
- **FFmpeg / ffprobe** : prérequis binaire hors Docker (cf. « Prérequis »). `npm run dev:setup` en vérifie la présence.

### Epic 1 — Bibliothèque et visionnage

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Listing + filtres + recherche (ST 1.1)** | Depuis `/bibliotheque` : (1) la grille affiche 20 extraits + pagination ; (2) filtre *Origine = Japon* → seuls les extraits JP restent ; (3) filtre *Type = Film* cumulable ; (4) recherche « Réverbérations » → 1 résultat ; (5) recherche sans correspondance → message « aucun résultat », aucun extrait `EN_ATTENTE`/`REJETE` visible. **Attendu** : filtres cumulatifs reflétés dans l'URL, pagination `aria-live`. | `src/lib/__tests__/extraits.test.ts`, `src/components/__tests__/BibliothequeListing.test.tsx`, `e2e/bibliotheque.spec.ts` |
| **Lecteur vidéo EMBED + UPLOAD (ST 1.2)** | QA dédiée : `/dev/lecteur` (hors production) — basculer entre une source EMBED et une source UPLOAD, vérifier lecture/pause/seek et l'absence de contrôles natifs indésirables. En conditions réelles : `/extraits/mock-001` (EMBED YouTube) et `/extraits/mock-002` (UPLOAD, fichier servi par `/api/media/play/*`). **Attendu** : la scène vidéo reste noire dans les deux thèmes. | `src/lib/__tests__/videoPlayer.test.ts`, `src/components/__tests__/VideoPlayer.test.tsx` *(3 tests EMBED en échec connu — FANDUB-TEST-1)* |
| **Script synchronisé + cas « pas de script » (ST 1.3)** | `/extraits/mock-001` : lancer la lecture, la ligne active du prompteur suit l'horodatage (silence volontaire entre 5,4 s et 5,9 s → aucune ligne surlignée). `/extraits/mock-002` : aucun script → le prompteur affiche l'état vide sans casser la mise en page. QA : `/dev/script-sync`. Édition interne : `/admin/scripts/mock-002` (⚠️ non authentifié). | `src/lib/__tests__/script.test.ts`, `src/components/__tests__/ScriptSynchronise.test.tsx`, `src/components/ui/__tests__/Prompter.test.tsx` |

### Epic 2 — Enregistrement vocal

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Enregistrement synchronisé (ST 2.1)** | `/dev/enregistrement` ou `/extraits/mock-001` : autoriser le micro, cliver *Enregistrer* → la vidéo démarre en parallèle, le niveau d'entrée s'anime (`LevelMeter`), l'arrêt fige une prise réécoutable calée sur la vidéo. **Attendu** : refus micro → message d'erreur explicite, pas de crash. | `src/lib/__tests__/voiceRecorder.test.ts`, `src/components/__tests__/VoiceRecorder.test.tsx` *(échec connu jsdom — FANDUB-TEST-2)*, `src/components/ui/__tests__/RecordBar.test.tsx` |
| **Réinitialisation (ST 2.2)** | Après une prise : *Recommencer* → confirmation, la prise est effacée, le curseur revient à 0, une nouvelle prise est possible sans recharger la page. | `src/lib/__tests__/audioBlobStore.test.ts`, `src/components/__tests__/VoiceRecorder.test.tsx` |

### Epic 3 — Export et partage

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Génération + téléchargement du doublage (ST 3.1)** | `/extraits/mock-002` (UPLOAD — l'export réel exige un flux vidéo direct) : enregistrer une prise → *Exporter*. Un job est créé (`POST /api/doublages`, `202`), `DoublageExport` fait du polling sur `GET /api/doublages/:id` jusqu'à `pret`, puis propose le téléchargement (URL signée expirante). **Worker requis** (`npm run worker`) hors mode mock — sinon le job reste `en_attente`. **Limite connue** : un extrait `EMBED` (`mock-001`) échoue en `echec` (FFmpeg ne démuxe pas une page de lecteur). | `src/lib/__tests__/doublage.test.ts`, `src/lib/__tests__/doublageProcessor.test.ts`, `src/components/__tests__/DoublageExport.test.tsx`, `e2e/bibliotheque.spec.ts` (surface d'export visible) |
| **Partage réseaux sociaux + page publique (ST 3.2)** | Sur un doublage `pret` : *Partager* → `POST /api/doublages/:id/partage` rend le doublage `lien_public` et renvoie l'URL `/doublage/:id`. Ouvrir cette URL en navigation privée : lecteur + boutons de partage + balises Open Graph/Twitter Card (vérifier le `<head>`). Un doublage non partagé → `/doublage/:id` renvoie 404. | `src/lib/__tests__/doublageShare.test.ts`, `src/components/__tests__/DoublageShareButtons.test.tsx` |

### Epic 4 — Comptes

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Inscription (ST 4.1)** | `/inscription` : e-mail, mot de passe, nom, prénom, âge (5–120). Validation partagée client/serveur (`fieldErrors`). Succès → cookie de session `httpOnly` posé, utilisateur connecté. E-mail déjà pris → `409`. Rate limiting : 5 tentatives / 10 min par IP (`429`). ⚠️ aucun seuil d'âge légal appliqué (point en suspens ST 4.1). | `src/lib/__tests__/auth.test.ts`, `src/lib/__tests__/password.test.ts`, `src/components/__tests__/RegisterForm.test.tsx` |
| **Connexion / « rester connecté » / déconnexion révoquée (ST 4.2)** | `/connexion` : identifiants valides → session. Case *Rester connecté* → session longue (30 j, valeur à valider). *Déconnexion* → `POST /api/auth/logout` **révoque réellement** la session côté serveur (Redis, ST 9.4) : réutiliser le cookie capturé avant déconnexion sur `GET /api/auth/session` → `401`. | `src/lib/__tests__/session.test.ts`, `src/lib/__tests__/sessionStore.test.ts`, `src/components/__tests__/LoginForm.test.tsx`, `src/components/__tests__/LogoutButton.test.tsx`, `e2e/auth.spec.ts` |
| **Acceptation des CGU (ST 4.3)** | Connecté, visiter `/cgu` → *Accepter* → `POST /api/auth/cgu` enregistre la version courante des CGU sur le compte. Tant que non accepté, l'accès à l'import est refusé (`403` sur `POST /api/import/upload-url`). | `src/lib/__tests__/cgu.test.ts` |

### Epic 5 — Import

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Formulaire d'import (ST 9.5) + compression (ST 5.1)** | Connecté + CGU acceptées, `/import` : choisir une vidéo (MP4/MOV/WebM/MKV, ≤ 500 Mo, ≤ 5 min), renseigner titre/origine/type, cocher la certification des droits, soumettre. Flux en 3 temps : `POST /api/import/upload-url` → PUT direct vers le stockage → `POST /api/import` (sonde `ffprobe`, job de compression BullMQ, `Extrait` créé `EN_ATTENTE`). Suivi par polling `GET /api/import/:id`. **Worker requis**. | `src/lib/__tests__/import.test.ts`, `src/lib/__tests__/importClient.test.ts`, `src/components/__tests__/ImportForm.test.tsx`, `e2e/import.spec.ts` *(`test.fixme`)* |
| **Certification des droits (ST 5.2)** | Décocher la case → `POST /api/import` répond `400` (`fieldErrors.certifieDroits`), rien n'est écrit, le fichier uploadé est nettoyé. Case cochée → horodatage + version (`CERTIFICATION_DROITS_VERSION`) enregistrés **sur l'`Extrait`**. | `src/lib/__tests__/certificationDroits.test.ts` |
| **Rejet vidéo > 5 min** | Importer une vidéo > 5 min → `POST /api/import` répond `422` et **le fichier est supprimé du stockage** immédiatement. | `src/lib/__tests__/videoProbe.test.ts`, `src/lib/__tests__/import.test.ts` |

### Epic 6 — Espace privé

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Sauvegarde privée + contrôle d'accès propriétaire (ST 6.1)** | Sur un doublage `pret` : *Sauvegarder* → `POST /api/doublages/:id/sauvegarder` (`201`, visibilité **privée** ; `200` si déjà sauvegardé — idempotent). Se connecter avec le **second compte** et tenter de lire ce doublage → refus (seul le propriétaire y accède). | `src/lib/__tests__/doublageSauvegarde.test.ts` |
| **Historique (ST 6.2)** | `/mon-espace/historique` (route protégée) : liste paginée des doublages sauvegardés, plus récents d'abord, avec titre/vignette de l'extrait d'origine ; par entrée : *Rejouer* (lecteur inline), *Télécharger*, *Partager*. | `src/lib/__tests__/doublage.test.ts`, `src/components/__tests__/DoublageHistoriqueListing.test.tsx` |
| **Historique → doublage (ST 11.2)** | Dans `/mon-espace/historique`, une entrée dont l'extrait est encore en ligne expose *Doubler à nouveau* → `/extraits/:id` (repart de l'extrait vierge, à distinguer de *Rejouer*). Entrée dont l'extrait a disparu ou est retiré → action masquée. | `src/components/__tests__/DoublageHistoriqueListing.test.tsx` |

### Epic 7 — Modération

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Signalement connecté et anonyme (ST 7.1)** | Sur `/doublage/:id` (ou une surface de lecture) : *Signaler* → motif → `POST /api/signalements` (`201`, statut `EN_ATTENTE`). **Fonctionne sans compte** ; connecté, l'auteur est enregistré. Rate limiting : 10 / 10 min par IP (`429`). Motif vide/trop long → `400`. | `src/lib/__tests__/signalement.test.ts`, `src/components/__tests__/SignalerButton.test.tsx`, `e2e/moderation.spec.ts` *(`test.fixme`)* |
| **Dashboard de modération (ST 7.2)** | Compte `MODERATEUR`, `/admin/moderation` : file filtrable (statut) / triable (ancienneté ↔ récence) / regroupée par contenu. Actions : *Rejeter*, *Retirer le contenu* (`Extrait.statut`/`Doublage.statutModeration` → `RETRAIT_MODERATION`), *Suspendre le compte* (`SUSPENDU`). Chaque décision est journalisée → `GET /api/admin/moderation/journal`. Compte non modérateur → `403`. | `src/lib/__tests__/moderation.test.ts`, `src/lib/__tests__/authz.test.ts`, `src/components/__tests__/ModerationDashboard.test.tsx` |
| **Notice-and-takedown + rapport des délais (ST 7.3)** | Formulaire **public** `/demande-retrait` (accepte `?type=EXTRAIT\|DOUBLAGE&id=…`) : identité, e-mail, œuvre, exposé, déclaration de bonne foi obligatoire → `POST /api/demandes-retrait` (`201`). Modérateur, `/admin/demandes-retrait` : file + *rapport des délais* (moyen/médian/max, respect du délai cible 72 h), actions *Retirer le contenu* (statut dédié `RETRAIT_AYANT_DROIT` + décision journalisée) / *Rejeter la demande*. | `src/lib/__tests__/demandeRetrait.test.ts`, `src/components/__tests__/DemandeRetraitForm.test.tsx`, `src/components/__tests__/DemandesRetraitDashboard.test.tsx`, `e2e/retrait.spec.ts` *(`test.fixme`)* |

### Epic 8 — Favoris

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Marquer un favori + badge « Contenu retiré » (ST 8.1)** | Connecté, sur une carte de `/bibliotheque` (slot `actions`) ou sur `/dev/lecteur` : bouton favori → `POST /api/extraits/:id/favori` (idempotent). `/mon-espace/favoris` affiche la grille ; retirer un favori fait disparaître la carte. Faire retirer l'extrait via la modération → dans `/mon-espace/favoris` la carte **reste affichée avec le badge « Contenu retiré »** (pas de disparition silencieuse — décision à confirmer, cf. dev-note ST 8.1). | `src/lib/__tests__/favori.test.ts`, `src/components/__tests__/FavoriButton.test.tsx`, `src/components/__tests__/FavorisListing.test.tsx` |
| **Favoris → doublage (ST 11.2)** | Dans `/mon-espace/favoris`, une carte dont l'extrait est `VALIDE` est cliquable vers `/extraits/:id` ; un extrait retiré (`estRetire`) ou introuvable n'a **pas** de lien (badge conservé). Le clic sur le bouton favori ne déclenche pas la navigation de la carte (`stopPropagation`). | `src/components/__tests__/FavorisListing.test.tsx` |

### Epic 9 — Infrastructure

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Bascule PostgreSQL / mode mock (ST 9.1)** | Sans `DATA_SOURCE=mock`, arrêter Postgres (`docker compose stop postgres`) → `/bibliotheque` renvoie une erreur serveur (aucun repli mémoire). Le relancer + `npm run db:seed` → contenu restauré. Avec `DATA_SOURCE=mock`, seules auth et import basculent sur des adaptateurs mockés — bibliothèque/historique/modération lisent toujours Postgres. | `src/lib/__tests__/st9.1-postgres.integration.test.ts`, `src/lib/__tests__/config.test.ts` |
| **Stockage objet MinIO (ST 9.2 / substitut local)** | Console MinIO `http://localhost:9001` (`minioadmin`/`minioadmin`), bucket `fandub-dev` créé par `minio-init`. Après un import réussi, le fichier compressé y apparaît. Arrêter `minio` → `POST /api/import` / `POST /api/doublages` échouent en tentant de joindre le stockage (sauf mode mock). | `src/lib/__tests__/objectStorage.test.ts`, `src/lib/__tests__/st9.2-object-storage.integration.test.ts` |
| **Traitement vidéo réel + worker (ST 9.3)** | `npm run worker` lancé : un job d'import ou de doublage progresse `en_attente` → `en_traitement` → `pret` (logs du worker : appels `ffprobe`/`ffmpeg` réels). Worker arrêté → le job reste `en_attente`. | `src/lib/__tests__/st9.3-ffmpeg-redis.integration.test.ts`, `src/lib/media/__tests__/jobQueues.test.ts` |
| **Persistance sessions + rate limiting Redis (ST 9.4)** | Dépasser un seuil (ex. 6 inscriptions en 10 min) → `429` ; redémarrer `npm run dev` **sans** vider Redis → le blocage persiste (compteurs dans Redis, plus en mémoire par process). Idem révocation de session (cf. ST 4.2). | `src/lib/__tests__/redisRateLimit.test.ts`, `src/lib/__tests__/st9.4-session-ratelimit.integration.test.ts` |

### Epic 10 — Parcours et cohérence

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Lien « Importer » dans la navigation (ST 10.1)** | Connecté → l'en-tête (`TopBar`) affiche *Importer* pointant vers `/import` ; déconnecté → absent. | `src/components/nav/__tests__/TopBar.test.tsx` |
| **Nom du compte dans l'en-tête (ST 10.2)** | Connecté → prénom/nom (ou e-mail) + avatar affichés dans `TopBar` ; déconnecté → *Connexion*. | `src/components/nav/__tests__/TopBar.test.tsx` |
| **Page publique unifiée d'un extrait (ST 10.3)** | `/extraits/mock-001` : visionnage + script synchronisé + surface d'enregistrement/export sur une seule page (2 colonnes). Atteignable depuis la bibliothèque, l'historique et les favoris. | `src/app/extraits/[id]/__tests__/ExtraitPageClient.test.tsx` |
| **Bouton d'export visible sur la page de l'extrait (ST 10.4)** | Sur `/extraits/:id`, la surface d'export (`DoublageExport`, `data-testid="doublage-export"`) est visible sans compte ; après export, *Sauvegarder* (ST 6.1) apparaît pour un compte connecté. | `e2e/bibliotheque.spec.ts` (« la page de l'extrait expose la surface d'export ») |
| **Garde-fou du seed en production (ST 10.5)** | `NODE_ENV=production npm run db:seed` → refus immédiat (`assertSeedAllowed`, [`src/lib/seedGuard.ts`](./src/lib/seedGuard.ts)) sauf `ALLOW_PRODUCTION_SEED=true`. Vérifier que les extraits de démo portent un `StatutModeration` normal (pas de traitement de faveur). | `src/lib/__tests__/seedGuard.test.ts` |

### Epic 11 — Habillage et outillage

| Fonctionnalité | Procédure | Test automatisé |
|---|---|---|
| **Design system + bascule de thème « mode scène » (ST 11.1)** | `TopBar` : l'interrupteur *Mode scène* (`Switch`) bascule `data-theme` sur `<html>` (via `useTheme`) ; le choix persiste après rechargement (localStorage). QA visuelle page par page contre `Claude output/Design system Doublure arcade/` dans les deux thèmes ; prompteur et scène vidéo restent noirs dans les deux. | `src/components/ui/__tests__/useTheme.test.tsx`, `src/components/ui/__tests__/Switch.test.tsx`, tests des composants `src/components/ui/__tests__/*` |
| **Environnement reproductible (ST 11.3)** | Depuis un `checkout` vierge : `docker compose up -d && npm ci && npm run dev:setup && npm run dev` → application fonctionnelle. `npm run test:e2e` → parcours actifs verts. Démontage : `npm run dev:reset`. Cf. [`e2e/README.md`](./e2e/README.md). | `e2e/*.spec.ts`, `scripts/dev-setup-check.mjs` |

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Démarre le serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Démarre le serveur de production (après build) |
| `npm run lint` | Lint du projet |
| `npm test` | Lance la suite de tests complète (Vitest) |
| `npm run test:ci` | Suite utilisée par la CI — exclut 3 fichiers dont les échecs sont préexistants et documentés (`VideoPlayer.test.tsx`, `VoiceRecorder.test.tsx`, `AdminScriptEditorClient.test.tsx`), cf. `vitest.config.ts` et dev-note ST 11.3 |
| `npm run test:e2e` | Parcours de bout en bout (Playwright) — voir `e2e/README.md` |
| `npm run test:e2e:ui` | Idem en mode interactif |
| `npm run test:watch` | Lance les tests en mode watch |
| `npm run prisma:generate` | Génère le client Prisma |
| `npm run prisma:migrate` | Applique les migrations Prisma en dev |
| `npm run dev:setup` | Amène une base opérationnelle depuis un `checkout` vierge (migrations + seed + contrôle des services), ST 11.3 |
| `npm run dev:reset` | Réinitialise la base et détruit les volumes Docker (`prisma migrate reset` + `docker compose down -v`), ST 11.3 |
| `npm run db:seed` | Injecte le jeu de données de démonstration (extraits + script, ST 9.1) — `prisma db seed` |
| `npm run worker` | Démarre le worker BullMQ (compression d'import + mixage de doublage, ST 9.3) — process séparé de `npm run dev`/`npm start`, requis hors `DATA_SOURCE=mock` pour que les jobs progressent (sinon ils restent en `en_attente`) |

## Routes

`/` redirige systématiquement vers `/bibliotheque` (aucune page d'accueil dédiée n'est prévue) — `src/app/page.tsx`.

`NEXT_PUBLIC_SITE_URL` (optionnel) : origine publique du site, utilisée pour construire les liens de partage absolus (ST 3.2). À défaut, l'origine de la requête est utilisée.

`AUTH_SESSION_SECRET` : secret de signature des jetons de session (ST 4.1). **Obligatoire en production** (≥ 32 caractères) ; hors production, un secret de développement non sûr est utilisé par défaut.

> Après un `git pull` modifiant `prisma/schema.prisma`, régénérer le client : `npx prisma generate` (les modèles `Utilisateur` — ST 4.1 —, `Doublage` — ST 6.1 —, `Signalement` — ST 7.1 —, `DecisionModeration` — ST 7.2 —, `DemandeRetrait` — ST 7.3 — et `Favori` — ST 8.1 —, ainsi que les colonnes `Utilisateur.role` / `Doublage.statutModeration` — ST 7.2 — et `DecisionModeration.demandeRetraitId` + la valeur d'enum `ActionModeration.RETRAIT_AYANT_DROIT` — ST 7.3 — en dépendent). Sous Windows, arrêter d'abord le serveur `next dev`, qui verrouille le moteur de requêtes Prisma.

> **Promouvoir un modérateur (ST 7.2)** : aucune interface ne le fait à ce stade. En base : `UPDATE utilisateurs SET role = 'MODERATEUR' WHERE email = '…';` (ou `role: "MODERATEUR"` dans le seed mock). Les dashboards `/admin/moderation` (ST 7.2) et `/admin/demandes-retrait` (ST 7.3) sont réservés aux rôles `MODERATEUR` / `ADMIN`.

> **Procédure notice-and-takedown (ST 7.3)** : la procédure de traitement des demandes de retrait des ayants droit est documentée dans `Claude output/procedure-notice-and-takedown.md`. ⚠️ Elle doit être validée par un professionnel du droit **avant mise en production** (risque juridique élevé — cahier des charges §9).

### Pages

| Route | Description |
|---|---|
| `/bibliotheque` | Page publique de listing des extraits (grille + filtres origine/type + recherche) — ST 1.1 |
| `/admin/scripts/:extraitId` | Éditeur interne de saisie/import des lignes de script d'un extrait — ST 1.3. ⚠️ non protégé (pas d'authentification à ce stade) |
| `/doublage/:id` | Page publique de partage d'un doublage : lecteur + boutons de partage réseaux sociaux + balises Open Graph/Twitter Card. Servie uniquement si le doublage a été rendu public (`POST /api/doublages/:id/partage`), sinon 404. Inclut l'action « Signaler » (ST 7.1) — ST 3.2 |
| `/inscription` | Formulaire de création de compte (e-mail, mot de passe, nom, prénom, âge). À la création, l'utilisateur est connecté (cookie de session `httpOnly`) — ST 4.1 |
| `/dev/lecteur` | Page de QA manuelle du lecteur vidéo (`VideoPlayer`, sources EMBED/UPLOAD) — ST 1.2, hors production uniquement |
| `/dev/script-sync` | Page de QA manuelle de la synchronisation script/vidéo — ST 1.3, hors production uniquement |
| `/dev/enregistrement` | Page de QA manuelle de l'enregistrement vocal synchronisé (`VoiceRecorder`) + export du doublage (`DoublageExport`, y compris génération du lien de partage ST 3.2) — ST 2.1/2.2/3.1/3.2, hors production uniquement |
| `/mon-espace/historique` | Historique des doublages sauvegardés du compte connecté : liste paginée avec, par doublage, rejouer (lecteur inline), télécharger (fichier déjà généré) et partager. Route réservée aux comptes (middleware `/mon-espace/*`) — ST 6.2 |
| `/mon-espace/favoris` | Grille des extraits marqués en favori par le compte connecté (réutilise le composant carte/listing de `/bibliotheque`) : chaque carte porte un bouton favori (déjà « rempli », le retirer fait disparaître la carte). Un extrait favori retiré depuis (modération/notice-and-takedown) reste affiché avec un badge « Contenu retiré » plutôt que disparaître silencieusement. Route réservée aux comptes (middleware `/mon-espace/*`) — ST 8.1 |
| `/admin/moderation` | Dashboard de modération : file des signalements (filtre statut, tri ancienneté/récence, regroupement par contenu) + actions (rejeter, retirer le contenu, suspendre le compte). Chaque décision est journalisée. Réservé aux rôles `MODERATEUR` / `ADMIN` (middleware `/admin/moderation/*` pour la présence de session, `exigerModerateur` pour le rôle) — ST 7.2 |
| `/demande-retrait` | Formulaire **public** de demande de retrait réservé aux ayants droit (identité, email de contact, œuvre, exposé, déclaration de bonne foi obligatoire). Accepte `?type=EXTRAIT\|DOUBLAGE&id=…` pour pré-remplir le contenu visé — ST 7.3 |
| `/admin/demandes-retrait` | Tableau de bord des demandes de retrait (procédure notice-and-takedown) : file (filtre statut), rapport des délais de traitement, actions « retirer le contenu » (statut `RETRAIT_AYANT_DROIT` + décision journalisée dédiée) et « rejeter la demande ». Réservé aux rôles `MODERATEUR` / `ADMIN` — ST 7.3 |

### API

| Route | Description |
|---|---|
| `GET /api/extraits` | Liste paginée des extraits au statut `VALIDE` — filtres `origine` (FR\|US\|JP), `type` (FILM\|SERIE\|DESSIN_ANIME), `q` (recherche texte titre), `page`, `pageSize` (max 50) — ST 1.1 |
| `GET /api/extraits/:id/script` | Lignes de script d'un extrait, triées par `timestampDebut` (tableau vide si aucun script) — ST 1.3 |
| `POST /api/extraits/:id/script` | Import atomique de lignes de script — corps `{ "lignes": [{ "texte", "timestampDebut", "timestampFin" }, ...] }`. ⚠️ non protégé (pas d'authentification à ce stade) — ST 1.3 |
| `POST /api/doublages` | Crée un job de génération du fichier de doublage (vidéo + voix). Corps `multipart/form-data` (`audio`, `extraitId`, `audioDurationSeconds`, `audioOffsetSeconds?`, `mode?`) ou JSON (`audioBase64`, …). Réponse `202` `{ job }`. Traitement FFmpeg réel + file BullMQ/Redis hors `DATA_SOURCE=mock` (ST 9.3, `npm run worker` requis) ; mocké/inline en mode mock — ST 3.1 / ST 9.3 |
| `GET /api/doublages/:id` | Statut d'un job de doublage (`en_attente` / `en_traitement` / `pret` / `echec`) + URL de téléchargement signée expirante quand `pret`. Polling depuis `DoublageExport` — ST 3.1 |
| `POST /api/doublages/:id/partage` | Rend un doublage `pret` partageable : visibilité → `lien_public`, renvoie `{ job }` avec `shareUrl` (page `/doublage/:id`). Idempotent. `409` si le job n'est pas prêt, `404` s'il est introuvable/expiré — ST 3.2 |
| `POST /api/doublages/:id/sauvegarder` | Lie le doublage généré `:id` (job `pret`) au compte connecté, **visibilité privée par défaut** (pas de re-génération : l'URL du fichier est recopiée du job). `201` `{ sauvegarde }` (ou `200` si déjà sauvegardé — idempotent) ; `401` (session absente), `404` (job introuvable/expiré), `409` (doublage pas encore prêt). Seul le propriétaire peut relire un doublage privé (`lireDoublageSauvegarde`) — ST 6.1 |
| `GET /api/doublages?utilisateur=me` | Historique paginé des doublages **sauvegardés** du compte connecté, les plus récents d'abord, chaque entrée enrichie du titre/vignette de l'extrait d'origine. Query : `utilisateur=me` (obligatoire), `page`, `pageSize` (défaut 12, max 50). `200` `{ items, pagination }` ; `400` (query invalide), `401` (session absente) — ST 6.2 |
| `POST /api/extraits/:id/favori` / `DELETE /api/extraits/:id/favori` | Ajoute/retire l'extrait `:id` des favoris du compte connecté. `POST` : `201` `{ favori }` (créé) ou `200` (déjà favori, idempotent) ; `404` si l'extrait est introuvable. `DELETE` : `200` `{ removed }`, toujours (idempotent — jamais d'erreur si le favori n'existait déjà pas, l'extrait n'est pas revérifié). `401` (session absente) sur les deux — ST 8.1 |
| `GET /api/favoris` | Liste paginée des favoris du compte connecté, les plus récents d'abord, chaque entrée enrichie du titre/vignette/statut de l'extrait favorisé (`extraitStatut` reste renseigné pour un extrait retiré par modération, afin que l'espace privé puisse afficher « contenu retiré » plutôt que perdre le favori). Query : `page`, `pageSize` (défaut 20, max 50 — pas de `utilisateur=me`, ce endpoint n'expose que le compte de la session). `200` `{ items, pagination }` ; `400` (query invalide), `401` (session absente) — ST 8.1 |
| `POST /api/auth/register` | Crée un compte — corps JSON `{ "email", "password", "nom", "prenom", "age", "accepteCgu" }` (`nom`/`prenom` non vides, `age` entier réaliste : 5-120). `201` `{ utilisateur }` + cookie de session `httpOnly` ; `400` (entrée invalide, `fieldErrors`), `409` (e-mail déjà utilisé), `429` (rate limiting par IP : 5 / 10 min). Mot de passe haché (scrypt). Rate limiting et révocation de session persistés dans Redis (ST 9.4), en mémoire par process seulement en mode `DATA_SOURCE=mock` ; ⚠️ aucun seuil d'âge légal (majorité) appliqué — cf. notes de dev ST 4.1 — ST 4.1 |
| `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/session` | Connexion, déconnexion (révoque réellement la session côté serveur depuis ST 9.4, plutôt que de se limiter à effacer le cookie), lecture de l'état de session — ST 4.2 |
| `POST /api/auth/cgu` | Enregistre l'acceptation de la version courante des CGU par l'utilisateur connecté — ST 4.3 |
| `POST /api/import/upload-url` | Génère une URL d'upload signée pour l'import d'une vidéo personnelle — corps JSON `{ "filename", "contentType", "sizeBytes" }`. `200` `{ upload }` ; `400` (format/taille), `401`/`403` (session / CGU non acceptées), `429` (20 / 10 min par IP). Réservé aux comptes ayant accepté les CGU. URL signée (HMAC) vers le stockage local hors `DATA_SOURCE=mock` (ST 9.3, substitut provisoire à S3 — cf. « Upload de vidéo ») — ST 5.1 / ST 9.3 |
| `POST /api/import` | Finalise un import : valide la vidéo réellement uploadée (`ffprobe` — durée ≤ 5 min, format, taille), lance la compression FFmpeg réelle (transcodage ≤ 720p, via la file BullMQ, `npm run worker`) et crée l'entrée `Extrait` au statut `EN_ATTENTE`. Corps JSON `{ "objectRef", "titre", "origine", "type", "certifieDroits": true }` (durée sondée côté serveur ; `certifieDroits` = case de certification des droits, obligatoire — ST 5.2). `202` `{ job }` ; `400` (dont `fieldErrors.certifieDroits` si non cochée), `401`/`403`, `404` (fichier absent), `422` (vidéo non conforme — **fichier supprimé du stockage**). Sonde/compression/job mockés et inline en mode mock — ST 5.1 / 5.2 / ST 9.3 |
| `GET /api/import/:id` | Statut d'un job d'import (`en_attente` / `en_traitement` / `pret` / `echec`) + `extraitId` quand `pret`. Réservé au propriétaire du job (`404` sinon). Polling — ST 5.1 |
| `PUT /api/media/upload/*ref` · `GET /api/media/play/*ref` · `GET /api/media/download/*ref` | Stockage local des fichiers vidéo/audio traités par FFmpeg (upload, lecture permanente de la bibliothèque, téléchargement temporaire d'un doublage) — substitut provisoire au stockage S3 tant que ST 9.2 n'est pas fusionnée sur `main`. Upload/téléchargement protégés par un jeton HMAC (`exp`/`sig`) ; lecture non signée (asset public de bibliothèque, comme une URL de CDN). Non pertinent en `DATA_SOURCE=mock` — ST 9.3 |
| `POST /api/signalements` | Enregistre un signalement de contenu — corps JSON `{ "contenuType": "EXTRAIT"\|"DOUBLAGE", "contenuId", "motif" }`. **Ouvert aux visiteurs non connectés** ; si une session est présente, le compte est enregistré comme auteur. `201` `{ signalement }` (statut `EN_ATTENTE`) ; `400` (motif manquant/trop long, `field`), `429` (rate limiting par IP : 10 / 10 min). Traité via le dashboard de modération (ST 7.2). Rate limiting persisté dans Redis (ST 9.4), en mémoire par process seulement en mode `DATA_SOURCE=mock` — ST 7.1 |
| `GET /api/admin/moderation` | File des signalements — query `statut` (défaut `EN_ATTENTE`), `tri` (`ANCIENNETE` défaut / `RECENCE`), `page`, `pageSize` (défaut 20, max 100). `200` `{ items, pagination }` (chaque entrée expose motif, auteur, nombre de signalements sur le même contenu) ; `400` (query invalide), `401` (session absente), `403` (rôle < `MODERATEUR`) — ST 7.2 |
| `POST /api/admin/moderation` | Action de modération — corps JSON `{ "action": "REJETER"\|"RETIRER_CONTENU"\|"SUSPENDRE_COMPTE", "signalementId"?, "compteCibleId"?, "commentaire"? }`. Retire le contenu (`Extrait.statut` / `Doublage.statutModeration` → `RETRAIT_MODERATION`) ou suspend le compte (`statut` → `SUSPENDU`), fait transiter le signalement (`REJETE` / `RETENU`) et journalise une `DecisionModeration`. `200` `{ decision, signalement }` ; `400`, `401`, `403`, `404` (signalement / contenu / compte introuvable), `409` (signalement déjà traité) — ST 7.2 |
| `GET /api/admin/moderation/journal` | Journal des décisions de modération, les plus récentes d'abord, paginé (`page`, `pageSize`). `200` `{ items, pagination }` ; `401` / `403` — ST 7.2 |
| `POST /api/demandes-retrait` | Enregistre une demande de retrait d'un ayant droit — corps JSON `{ contenuType, contenuId, oeuvre, demandeurNom, demandeurEmail, demandeurOrganisation?, motif, declarationBonneFoi: true }`. **Ouvert sans compte.** `201` `{ demande }` (statut `EN_ATTENTE`) ; `400` (`field`, dont déclaration manquante), `429` (rate limiting par IP : 5 / h). Rate limiting persisté dans Redis (ST 9.4), en mémoire par process seulement en mode `DATA_SOURCE=mock` ; aucun email envoyé — ST 7.3 |
| `GET /api/admin/demandes-retrait` | File des demandes de retrait — query `statut` (défaut `EN_ATTENTE`), `tri` (`ANCIENNETE` / `RECENCE`), `page`, `pageSize` (défaut 20, max 100). `200` `{ items, pagination }` ; `400` / `401` / `403` — ST 7.3 |
| `POST /api/admin/demandes-retrait` | Action modérateur — corps `{ action: "TRAITER"\|"REJETER", demandeId, commentaire? }`. `TRAITER` : contenu visé → `RETRAIT_AYANT_DROIT`, demande → `TRAITEE`, décision `RETRAIT_AYANT_DROIT` journalisée. `REJETER` : demande → `REJETEE`. `200` `{ demande, decisionId }` ; `400` / `404` / `409` (déjà traitée) / `401` / `403` — ST 7.3 |
| `GET /api/admin/demandes-retrait/rapport` | Rapport des délais de traitement (total, en attente / traitées / rejetées, délais moyen / médian / max, respect du délai cible 72 h). `200` ; `401` / `403` — ST 7.3 |

Les endpoints ci-dessus interrogent toujours Prisma/Postgres (ST 9.1 « Bascule intégrale sur PostgreSQL » — l'ancienne bascule `DATA_SOURCE=mock` vers un jeu de données en mémoire, encore utilisée par certaines routes d'authentification et d'import, cf. `src/lib/config.ts`, a été retirée pour `GET /api/extraits`, `GET /api/extraits/:id/script`, `GET /api/doublages`, `GET /api/admin/moderation` et `GET /api/admin/demandes-retrait`, ainsi que pour les mutations qui alimentent ces mêmes tables — `POST /api/extraits/:id/script`, `POST /api/signalements`, `POST /api/demandes-retrait`, `POST/DELETE /api/doublages/:id/sauvegarder`, `POST /api/admin/moderation`, `POST /api/admin/demandes-retrait`). Un jeu de données de démonstration (extraits + script) est injecté par `npm run db:seed` — voir « Installation ».

## Upload de vidéo

Orchestration et contrats en place (ST 5.1 « Import et compression vidéo », US 5.1). Flux en trois temps, réservé aux comptes ayant accepté les CGU (ST 4.2 + ST 4.3) :

1. `POST /api/import/upload-url` → URL d'upload signée (validation du format et de la taille **déclarés**).
2. Le client PUT le fichier directement vers cette URL (stockage objet, pas via l'API applicative).
3. `POST /api/import` → sonde de la vidéo réelle (`ffprobe`), **validation post-upload** (durée ≤ 5 min **stricte**, format, taille — un fichier non conforme est supprimé du stockage immédiatement), job de compression FFmpeg (transcodage MP4 H.264/AAC ≤ 720p), puis création de l'entrée `Extrait` (`source = UPLOAD`, `statut = EN_ATTENTE`). Suivi par polling sur `GET /api/import/:id`.

Limites : durée ≤ 5 min (`MAX_IMPORT_DURATION_SECONDS`), taille ≤ 500 Mo, formats MP4 / MOV / WebM / MKV (cf. `src/lib/importClient.ts`).

**Certification des droits (ST 5.2)** — l'étape 3 exige `certifieDroits: true` (case à cocher du futur formulaire d'import). Sans elle, `POST /api/import` répond `400` sans rien écrire et le fichier uploadé est nettoyé. Quand elle est cochée, l'horodatage et la version du texte certifié (`CERTIFICATION_DROITS_VERSION`, `src/lib/certificationDroits.ts`) sont enregistrés **sur l'`Extrait`** (`certificationDroitsLe` / `certificationDroitsVersion`) — preuve individuelle par import, distincte de l'acceptation des CGU (ST 4.3, unique par compte). Texte à faire valider par un juriste avant production.

Depuis ST 9.3 (« Traitement vidéo réel »), hors `DATA_SOURCE=mock` : `ffprobe`/FFmpeg sont réellement lancés (binaires du système — `FFMPEG_PATH`/`FFPROBE_PATH` si hors `PATH`) et la compression est traitée de façon asynchrone par un worker BullMQ dédié (`npm run worker`, consommant Redis) plutôt qu'inline dans la requête. En mode mock, comportement inchangé (adaptateurs mockés, job inline).

⚠️ **Périmètre restant** — la story technique dépend explicitement de ST 9.2 (« Stockage objet réel », S3/MinIO) pour le stockage des fichiers, or cette story n'est pas fusionnée sur `main` à ce stade (branche `st-9.2-stockage-objet-reel`). Le fichier source uploadé et la vidéo compressée vivent donc dans un **stockage disque local** (`MEDIA_STORAGE_DIR`, défaut `.data/media`, cf. `src/lib/media/localMediaStore.ts`), servi par `PUT/GET /api/media/*` — un simple substitut à remplacer par le client S3 de ST 9.2 à sa fusion (surface d'adaptation volontairement réduite à 4 fonctions, cf. commentaires de tête du fichier). Le mixage d'un extrait `Extrait.source = EMBED` (YouTube/Vimeo intégré, pas de flux vidéo direct) échoue (`status: "echec"`) : FFmpeg ne sait pas démuxer une page de lecteur embarqué — limite documentée, pas gérée explicitement (cf. `src/lib/doublageProcessor.ts`). Le branchement des vraies briques (S3, autre file de jobs) se fait en fournissant d'autres implémentations des interfaces de `src/lib/import.ts`/`src/lib/doublage.ts` (`SignedUploadUrlIssuer`, `UploadedVideoProbe`, `VideoCompressor`, `ObjectStorageCleaner`, `ExtraitLibraryWriter`, `DoublageProcessor`, `SignedUrlIssuer`), sans toucher au reste du code. Voir les notes de dev ST 5.1 et ST 9.3.

Le **formulaire d'import** (`/import`, déjà réservé par le middleware ST 4.2) et l'upload côté navigateur ne sont pas encore développés — signalés comme points en suspens (ST 5.1 ne découpe que le backend).

## État du projet

Stories techniques implémentées à ce stade : ST 1.1 (bibliothèque), ST 1.2 (lecteur vidéo), ST 1.3 (synchronisation script), ST 2.1/2.2 (enregistrement vocal synchronisé + remise à zéro), ST 3.1 (génération + téléchargement du fichier de doublage — orchestration et contrats en place ; mixage FFmpeg réel + file BullMQ/Redis depuis ST 9.3), ST 3.2 (partage réseaux sociaux : page publique `/doublage/:id`, métadonnées Open Graph, Web Share API + liens d'intent — même réserve de persistance en mémoire que ST 3.1), ST 4.1 (inscription : `/inscription` + `POST /api/auth/register`, champs e-mail/mot de passe/nom/prénom/âge, validation partagée client/serveur, hachage scrypt, cookie de session émis — hachage argon2 et seuil d'âge légal restant à trancher, rate limiting persisté depuis ST 9.4, cf. notes de dev), ST 4.2 (connexion/déconnexion + middleware — déconnexion révoquant réellement la session côté serveur depuis ST 9.4), ST 4.3 (acceptation des CGU), ST 5.1 (import et compression vidéo — endpoints, validation post-upload durée/format/taille, machine à états du job de compression, création de l'`Extrait` EN_ATTENTE ; sonde/compression FFmpeg réelles + file BullMQ/Redis depuis ST 9.3, stockage S3 restant à brancher (ST 9.2), formulaire d'import à faire — cf. notes de dev), ST 5.2 (certification des droits à l'import — case obligatoire bloquant la finalisation, preuve horodatée + versionnée enregistrée par extrait), ST 6.1 (sauvegarde privée d'un doublage — modèle `Doublage`, endpoint de sauvegarde idempotent, contrôle d'accès propriétaire), ST 6.2 (historique des doublages — `/mon-espace/historique`, `GET /api/doublages?utilisateur=me` paginé), ST 7.1 (signalement de contenu — modèle `Signalement`, `POST /api/signalements` public rate-limité par IP, bouton « Signaler » sur les surfaces de lecture), ST 7.2 (dashboard de modération — rôle `RoleUtilisateur` + RBAC minimal `src/lib/authz.ts`, page `/admin/moderation` réservée aux modérateurs, file filtrable/triable, actions rejeter / retirer le contenu / suspendre le compte, journal `DecisionModeration` ; suppression de compte volontairement non implémentée, cf. notes de dev), ST 7.3 (procédure notice-and-takedown — modèle `DemandeRetrait`, formulaire public `/demande-retrait` + `POST /api/demandes-retrait` rate-limité, tableau de bord `/admin/demandes-retrait` réservé aux modérateurs, statut de retrait dédié `RETRAIT_AYANT_DROIT` distinct de `RETRAIT_MODERATION` + décision journalisée dédiée, rapport des délais de traitement ; procédure documentée à faire valider juridiquement avant mise en production, cf. notes de dev), ST 8.1 (favoris — modèle `Favori` (couple utilisateur/extrait, contrainte d'unicité), `POST`/`DELETE /api/extraits/:id/favori` (bascule idempotente), `GET /api/favoris` paginé, bouton favori sur la carte d'extrait (bibliothèque **et** `/mon-espace/favoris`, nouveau slot `actions` de `ClipCard`) et sur le lecteur QA (`/dev/lecteur`, faute de page publique de lecture d'extrait) ; extrait retiré depuis un favori : affiché avec un badge « Contenu retiré » plutôt que supprimé silencieusement, décision prise pour le point d'attention laissé ouvert par la story — à confirmer avec le porteur de projet, cf. notes de dev), ST 9.1 (bascule intégrale sur PostgreSQL — retrait de `DATA_SOURCE=mock` pour la bibliothèque (ST 1.1/1.3), l'historique des doublages (ST 6.2), le signalement/la modération (ST 7.1/7.2) et les demandes de retrait (ST 7.3), ainsi que pour les mutations qui alimentent ces mêmes tables ; jeu de données de démonstration injecté par `prisma/seed.ts` (`npm run db:seed`) ; migration `doublages` manquante ajoutée au passage (gap préexistant signalé par ST 8.1, bloquant `prisma migrate deploy` sur une base vierge) ; pipeline CI ajouté (`.github/workflows/ci.yml`, Postgres de test) ; authentification, import et rate limiting restent hors périmètre (bascule/persistance traitées par d'autres stories de l'Epic 9) — cf. notes de dev), ST 9.3 (traitement vidéo réel — sonde `ffprobe` et compression/mixage `ffmpeg` réels remplaçant les mocks de ST 5.1/ST 3.1, file d'attente asynchrone BullMQ + Redis remplaçant l'exécution inline (`npm run worker`, process séparé de l'API), stockage local des fichiers traités (`MEDIA_STORAGE_DIR`) en substitut provisoire à ST 9.2 non fusionnée, servi par `/api/media/*` (upload signé HMAC, lecture permanente, téléchargement signé temporaire) ; export réel limité aux extraits dont la vidéo est directement accessible (pas les extraits `EMBED` YouTube/Vimeo) — cf. notes de dev), ST 9.4 (persistance des sessions et du rate limiting — store de révocation de session (`lib/sessionStore.ts`) et compteurs de rate limiting (inscription, connexion, signalement, demande de retrait, import) migrés vers Redis, remplaçant les stores en mémoire par process ; jeton de session désormais porteur d'un identifiant (`jti`) permettant une vraie invalidation à la déconnexion (`POST /api/auth/logout`), au lieu de se limiter à effacer le cookie — cf. notes de dev), ST 10.5 (clarification du jeu de données de démonstration de la bibliothèque — le retrait du mock (« point signalé ») était déjà traité par ST 9.1 ; ajout d'un garde-fou empêchant `prisma/seed.ts` de s'exécuter avec `NODE_ENV=production` (`assertSeedAllowed`, `src/lib/seedGuard.ts`), et vérification que les extraits de démonstration portent le même statut de modération (`StatutModeration`) qu'un contenu réel — cf. notes de dev). Voir les notes de dev dans [`Claude output/dev-note/`](./Claude%20output/dev-note/) pour le détail des décisions prises et les points en suspens (endpoints admin non protégés, etc.).

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
