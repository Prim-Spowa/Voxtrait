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
- Docker (ou tout MinIO/S3 accessible) pour le stockage objet — ST 9.2

## Installation

```bash
npm install
cp .env.example .env
# renseigner DATABASE_URL dans .env
npx prisma migrate dev
npm run db:seed
docker compose up -d minio
```

`npm run db:seed` (ST 9.1) injecte un jeu de données de démonstration — extraits (bibliothèque, ST 1.1) et lignes de script (ST 1.3) — équivalent à l'ancien mode `DATA_SOURCE=mock`, mais dans la vraie base Postgres locale. Script idempotent (`prisma/seed.ts`), à relancer sans risque après un `prisma migrate reset`.

`docker compose up -d minio` (ST 9.2) démarre un MinIO local (compatible S3) sur `http://localhost:9000`, avec le bucket `fandub-dev` créé automatiquement (`docker-compose.yml`) — identifiants et bucket déjà alignés avec le repli par défaut de `getObjectStorageConfig` (`src/lib/objectStorage.ts`), donc rien à ajouter dans `.env` pour développer en local. Console web : `http://localhost:9001` (`minioadmin` / `minioadmin`). Sans ce service, les endpoints d'import (`POST /api/import/upload-url`, `POST /api/import`) et de génération du doublage (`POST /api/doublages`) échoueront en essayant de joindre le stockage réel — sauf en mode `DATA_SOURCE=mock` (adaptateurs mockés, sans dépendance à MinIO).

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Démarre le serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Démarre le serveur de production (après build) |
| `npm run lint` | Lint du projet |
| `npm test` | Lance la suite de tests |
| `npm run test:ci` | Suite de tests utilisée par la CI — exclut 4 fichiers dont les échecs sont préexistants et sans rapport avec les stories en cours (`VideoPlayer.test.tsx`, `VoiceRecorder.test.tsx`, `useClipPlayback.test.jsx`, `AdminScriptEditorClient.test.tsx`), cf. notes de dev ST 9.1 |
| `npm run test:watch` | Lance les tests en mode watch |
| `npm run prisma:generate` | Génère le client Prisma |
| `npm run prisma:migrate` | Applique les migrations Prisma en dev |
| `npm run db:seed` | Injecte le jeu de données de démonstration (extraits + script, ST 9.1) — `prisma db seed` |

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
| `POST /api/doublages` | Crée un job de génération du fichier de doublage (vidéo + voix). Corps `multipart/form-data` (`audio`, `extraitId`, `audioDurationSeconds`, `audioOffsetSeconds?`, `mode?`) ou JSON (`audioBase64`, …). Réponse `202` `{ job }`. URL de téléchargement signée S3/MinIO réelle (ST 9.2). ⚠️ traitement FFmpeg **mocké**, job exécuté inline (ni BullMQ ni Redis) — ST 3.1 / 9.2 |
| `GET /api/doublages/:id` | Statut d'un job de doublage (`en_attente` / `en_traitement` / `pret` / `echec`) + URL de téléchargement signée expirante quand `pret`. Polling depuis `DoublageExport` — ST 3.1 |
| `POST /api/doublages/:id/partage` | Rend un doublage `pret` partageable : visibilité → `lien_public`, renvoie `{ job }` avec `shareUrl` (page `/doublage/:id`). Idempotent. `409` si le job n'est pas prêt, `404` s'il est introuvable/expiré — ST 3.2 |
| `POST /api/doublages/:id/sauvegarder` | Lie le doublage généré `:id` (job `pret`) au compte connecté, **visibilité privée par défaut** (pas de re-génération : l'URL du fichier est recopiée du job). `201` `{ sauvegarde }` (ou `200` si déjà sauvegardé — idempotent) ; `401` (session absente), `404` (job introuvable/expiré), `409` (doublage pas encore prêt). Seul le propriétaire peut relire un doublage privé (`lireDoublageSauvegarde`) — ST 6.1 |
| `GET /api/doublages?utilisateur=me` | Historique paginé des doublages **sauvegardés** du compte connecté, les plus récents d'abord, chaque entrée enrichie du titre/vignette de l'extrait d'origine. Query : `utilisateur=me` (obligatoire), `page`, `pageSize` (défaut 12, max 50). `200` `{ items, pagination }` ; `400` (query invalide), `401` (session absente) — ST 6.2 |
| `POST /api/extraits/:id/favori` / `DELETE /api/extraits/:id/favori` | Ajoute/retire l'extrait `:id` des favoris du compte connecté. `POST` : `201` `{ favori }` (créé) ou `200` (déjà favori, idempotent) ; `404` si l'extrait est introuvable. `DELETE` : `200` `{ removed }`, toujours (idempotent — jamais d'erreur si le favori n'existait déjà pas, l'extrait n'est pas revérifié). `401` (session absente) sur les deux — ST 8.1 |
| `GET /api/favoris` | Liste paginée des favoris du compte connecté, les plus récents d'abord, chaque entrée enrichie du titre/vignette/statut de l'extrait favorisé (`extraitStatut` reste renseigné pour un extrait retiré par modération, afin que l'espace privé puisse afficher « contenu retiré » plutôt que perdre le favori). Query : `page`, `pageSize` (défaut 20, max 50 — pas de `utilisateur=me`, ce endpoint n'expose que le compte de la session). `200` `{ items, pagination }` ; `400` (query invalide), `401` (session absente) — ST 8.1 |
| `POST /api/auth/register` | Crée un compte — corps JSON `{ "email", "password", "nom", "prenom", "age", "accepteCgu" }` (`nom`/`prenom` non vides, `age` entier réaliste : 5-120). `201` `{ utilisateur }` + cookie de session `httpOnly` ; `400` (entrée invalide, `fieldErrors`), `409` (e-mail déjà utilisé), `429` (rate limiting par IP : 5 / 10 min). Mot de passe haché (scrypt). ⚠️ rate limiting et store de session **en mémoire par process** ; aucun seuil d'âge légal (majorité) appliqué — cf. notes de dev ST 4.1 — ST 4.1 |
| `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/session` | Connexion, déconnexion, lecture de l'état de session — ST 4.2 |
| `POST /api/auth/cgu` | Enregistre l'acceptation de la version courante des CGU par l'utilisateur connecté — ST 4.3 |
| `POST /api/import/upload-url` | Génère une URL d'upload signée pour l'import d'une vidéo personnelle — corps JSON `{ "filename", "contentType", "sizeBytes" }`. `200` `{ upload }` ; `400` (format/taille), `401`/`403` (session / CGU non acceptées), `429` (20 / 10 min par IP). Réservé aux comptes ayant accepté les CGU. URL signée S3/MinIO réelle (ST 9.2), sauf `DATA_SOURCE=mock` — ST 5.1 / 9.2 |
| `POST /api/import` | Finalise un import : valide la vidéo uploadée (durée ≤ 5 min, format, taille), lance la compression FFmpeg et crée l'entrée `Extrait` au statut `EN_ATTENTE`. Corps JSON `{ "objectRef", "titre", "origine", "type", "certifieDroits": true }` (durée sondée côté serveur ; `certifieDroits` = case de certification des droits, obligatoire — ST 5.2). `202` `{ job }` ; `400` (dont `fieldErrors.certifieDroits` si non cochée), `401`/`403`, `404` (fichier absent), `422` (vidéo non conforme — **fichier supprimé du stockage réel**, ST 9.2). ⚠️ sonde vidéo/compression FFmpeg **mockées** (ST 9.3), job exécuté inline — ST 5.1 / 5.2 / 9.2 |
| `GET /api/import/:id` | Statut d'un job d'import (`en_attente` / `en_traitement` / `pret` / `echec`) + `extraitId` quand `pret`. Réservé au propriétaire du job (`404` sinon). Polling — ST 5.1 |
| `POST /api/signalements` | Enregistre un signalement de contenu — corps JSON `{ "contenuType": "EXTRAIT"\|"DOUBLAGE", "contenuId", "motif" }`. **Ouvert aux visiteurs non connectés** ; si une session est présente, le compte est enregistré comme auteur. `201` `{ signalement }` (statut `EN_ATTENTE`) ; `400` (motif manquant/trop long, `field`), `429` (rate limiting par IP : 10 / 10 min). Traité via le dashboard de modération (ST 7.2). ⚠️ rate limiting **en mémoire par process** (ST 9.4, non traité) — ST 7.1 |
| `GET /api/admin/moderation` | File des signalements — query `statut` (défaut `EN_ATTENTE`), `tri` (`ANCIENNETE` défaut / `RECENCE`), `page`, `pageSize` (défaut 20, max 100). `200` `{ items, pagination }` (chaque entrée expose motif, auteur, nombre de signalements sur le même contenu) ; `400` (query invalide), `401` (session absente), `403` (rôle < `MODERATEUR`) — ST 7.2 |
| `POST /api/admin/moderation` | Action de modération — corps JSON `{ "action": "REJETER"\|"RETIRER_CONTENU"\|"SUSPENDRE_COMPTE", "signalementId"?, "compteCibleId"?, "commentaire"? }`. Retire le contenu (`Extrait.statut` / `Doublage.statutModeration` → `RETRAIT_MODERATION`) ou suspend le compte (`statut` → `SUSPENDU`), fait transiter le signalement (`REJETE` / `RETENU`) et journalise une `DecisionModeration`. `200` `{ decision, signalement }` ; `400`, `401`, `403`, `404` (signalement / contenu / compte introuvable), `409` (signalement déjà traité) — ST 7.2 |
| `GET /api/admin/moderation/journal` | Journal des décisions de modération, les plus récentes d'abord, paginé (`page`, `pageSize`). `200` `{ items, pagination }` ; `401` / `403` — ST 7.2 |
| `POST /api/demandes-retrait` | Enregistre une demande de retrait d'un ayant droit — corps JSON `{ contenuType, contenuId, oeuvre, demandeurNom, demandeurEmail, demandeurOrganisation?, motif, declarationBonneFoi: true }`. **Ouvert sans compte.** `201` `{ demande }` (statut `EN_ATTENTE`) ; `400` (`field`, dont déclaration manquante), `429` (rate limiting par IP : 5 / h). ⚠️ rate limiting **en mémoire par process** (ST 9.4, non traité) ; aucun email envoyé — ST 7.3 |
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

⚠️ **Périmètre** — même posture que ST 3.1 : le client S3, `ffprobe`, FFmpeg et la file de jobs (BullMQ/Redis) ne sont **pas installés**. Les endpoints utilisent des adaptateurs **mockés** (`src/lib/mocks/import.mock.ts`) et le job est exécuté **inline**. Le branchement des vraies briques se fait en fournissant d'autres implémentations des interfaces de `src/lib/import.ts` (`SignedUploadUrlIssuer`, `UploadedVideoProbe`, `VideoCompressor`, `ObjectStorageCleaner`, `ExtraitLibraryWriter`), sans toucher au reste du code. Voir les notes de dev ST 5.1.

Le **formulaire d'import** (`/import`, déjà réservé par le middleware ST 4.2) et l'upload côté navigateur ne sont pas encore développés — signalés comme points en suspens (ST 5.1 ne découpe que le backend).

## État du projet

Stories techniques implémentées à ce stade : ST 1.1 (bibliothèque), ST 1.2 (lecteur vidéo), ST 1.3 (synchronisation script), ST 2.1/2.2 (enregistrement vocal synchronisé + remise à zéro), ST 3.1 (génération + téléchargement du fichier de doublage — orchestration et contrats en place, brique FFmpeg/BullMQ toujours mockée, stockage S3 réel depuis ST 9.2), ST 3.2 (partage réseaux sociaux : page publique `/doublage/:id`, métadonnées Open Graph, Web Share API + liens d'intent — même réserve de persistance en mémoire que ST 3.1), ST 4.1 (inscription : `/inscription` + `POST /api/auth/register`, champs e-mail/mot de passe/nom/prénom/âge, validation partagée client/serveur, hachage scrypt, cookie de session émis — hachage argon2, seuil d'âge légal et persistance du rate limiting restant à trancher/brancher, cf. notes de dev), ST 4.2 (connexion/déconnexion + middleware), ST 4.3 (acceptation des CGU), ST 5.1 (import et compression vidéo — endpoints, validation post-upload durée/format/taille, machine à états du job de compression, création de l'`Extrait` EN_ATTENTE ; brique S3 réelle depuis ST 9.2, `ffprobe`/FFmpeg encore mockés (ST 9.3), job inline, formulaire d'import à faire — cf. notes de dev), ST 5.2 (certification des droits à l'import — case obligatoire bloquant la finalisation, preuve horodatée + versionnée enregistrée par extrait), ST 6.1 (sauvegarde privée d'un doublage — modèle `Doublage`, endpoint de sauvegarde idempotent, contrôle d'accès propriétaire), ST 6.2 (historique des doublages — `/mon-espace/historique`, `GET /api/doublages?utilisateur=me` paginé), ST 7.1 (signalement de contenu — modèle `Signalement`, `POST /api/signalements` public rate-limité par IP, bouton « Signaler » sur les surfaces de lecture), ST 7.2 (dashboard de modération — rôle `RoleUtilisateur` + RBAC minimal `src/lib/authz.ts`, page `/admin/moderation` réservée aux modérateurs, file filtrable/triable, actions rejeter / retirer le contenu / suspendre le compte, journal `DecisionModeration` ; suppression de compte volontairement non implémentée, cf. notes de dev), ST 7.3 (procédure notice-and-takedown — modèle `DemandeRetrait`, formulaire public `/demande-retrait` + `POST /api/demandes-retrait` rate-limité, tableau de bord `/admin/demandes-retrait` réservé aux modérateurs, statut de retrait dédié `RETRAIT_AYANT_DROIT` distinct de `RETRAIT_MODERATION` + décision journalisée dédiée, rapport des délais de traitement ; procédure documentée à faire valider juridiquement avant mise en production, cf. notes de dev), ST 8.1 (favoris — modèle `Favori` (couple utilisateur/extrait, contrainte d'unicité), `POST`/`DELETE /api/extraits/:id/favori` (bascule idempotente), `GET /api/favoris` paginé, bouton favori sur la carte d'extrait (bibliothèque **et** `/mon-espace/favoris`, nouveau slot `actions` de `ClipCard`) et sur le lecteur QA (`/dev/lecteur`, faute de page publique de lecture d'extrait) ; extrait retiré depuis un favori : affiché avec un badge « Contenu retiré » plutôt que supprimé silencieusement, décision prise pour le point d'attention laissé ouvert par la story — à confirmer avec le porteur de projet, cf. notes de dev), ST 9.1 (bascule intégrale sur PostgreSQL — retrait de `DATA_SOURCE=mock` pour la bibliothèque (ST 1.1/1.3), l'historique des doublages (ST 6.2), le signalement/la modération (ST 7.1/7.2) et les demandes de retrait (ST 7.3), ainsi que pour les mutations qui alimentent ces mêmes tables ; jeu de données de démonstration injecté par `prisma/seed.ts` (`npm run db:seed`) ; migration `doublages` manquante ajoutée au passage (gap préexistant signalé par ST 8.1, bloquant `prisma migrate deploy` sur une base vierge) ; pipeline CI ajouté (`.github/workflows/ci.yml`, Postgres de test) ; authentification, import et rate limiting restent hors périmètre (bascule/persistance traitées par d'autres stories de l'Epic 9) — cf. notes de dev), ST 9.2 (stockage objet réel pour les fichiers vidéo/audio — client S3 configurable par variables d'environnement (`src/lib/objectStorage.ts`), `SignedUploadUrlIssuer`/`ObjectStorageCleaner` réels branchés sur `POST /api/import/upload-url`/`POST /api/import` (ST 5.1) et `SignedUrlIssuer` réel branché sur `POST /api/doublages` (ST 3.1), tous les trois sauf en mode `DATA_SOURCE=mock` ; MinIO fourni en local via `docker-compose.yml` (identifiants/bucket alignés sur le repli par défaut, `next dev` fonctionne sans configuration) et en CI (`.github/workflows/ci.yml`, démarré via `docker run`) ; sonde vidéo (`ffprobe`) et compresseur FFmpeg/mixeur de doublage restent mockés, hors périmètre de cette story (ST 9.3) — cf. notes de dev). Voir les notes de dev dans [`Claude output/dev-note/`](./Claude%20output/dev-note/) pour le détail des décisions prises et les points en suspens (endpoints admin non protégés, etc.).

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
