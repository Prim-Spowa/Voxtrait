-- Migration : table `favoris` (ST 8.1 « Marquer une scène en favori »).
--
-- Table de liaison minimale utilisateur <-> extrait (« scène » = extrait, pas
-- de nouvelle entité de contenu). `extrait_id` n'est pas une clé étrangère —
-- même choix que `signalements.contenu_id` (ST 7.1) / `doublages.extrait_id`
-- (ST 6.1) : un extrait retiré par la suite ne doit pas empêcher la ligne de
-- survivre côté favoris (l'espace privé peut alors afficher « contenu
-- retiré » plutôt que de perdre l'entrée silencieusement).

-- CreateTable
CREATE TABLE "favoris" (
    "id" TEXT NOT NULL,
    "utilisateur_id" TEXT NOT NULL,
    "extrait_id" TEXT NOT NULL,
    "date_ajout" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favoris_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Contrainte d'unicité du couple (utilisateur, extrait) exigée par la story —
-- un favori par compte et par extrait ; sert de garde-fou d'idempotence au
-- toggle (cf. `ajouterFavori`, `src/lib/favori.ts`).
CREATE UNIQUE INDEX "favoris_utilisateur_id_extrait_id_key" ON "favoris"("utilisateur_id", "extrait_id");

-- CreateIndex
-- Listing paginé de l'espace privé (« mon espace / favoris »), le plus récent
-- d'abord.
CREATE INDEX "favoris_utilisateur_id_date_ajout_idx" ON "favoris"("utilisateur_id", "date_ajout");

-- AddForeignKey
-- `ON DELETE CASCADE` : la suppression d'un compte emporte ses favoris (même
-- posture que `doublages.utilisateur_id`, ST 6.1).
ALTER TABLE "favoris"
    ADD CONSTRAINT "favoris_utilisateur_id_fkey"
    FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateurs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
