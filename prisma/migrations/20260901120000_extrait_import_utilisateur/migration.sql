-- Migration : traçabilité des imports utilisateur sur `extraits`
-- (ST 5.1 « Import et compression vidéo »).
--
-- Ajoute sur `extraits` :
--  - `duree_secondes`  : durée réelle de la vidéo importée (sondée côté
--                        serveur, validée ≤ 5 min — cf. src/lib/importClient.ts) ;
--  - `importe_par_id`   : compte qui a importé l'extrait (null pour les
--                        extraits ajoutés par seed/admin).
--
-- Colonnes nullables : les extraits existants ne sont pas issus d'un import
-- utilisateur.
--
-- `ON DELETE SET NULL` : supprimer un compte ne retire pas ses imports déjà
-- publiés en bibliothèque — la modération (Epic 7) reste maîtresse du contenu.

-- AlterTable
ALTER TABLE "extraits"
    ADD COLUMN "duree_secondes" INTEGER,
    ADD COLUMN "importe_par_id" TEXT;

-- CreateIndex
CREATE INDEX "extraits_importe_par_id_idx" ON "extraits"("importe_par_id");

-- AddForeignKey
ALTER TABLE "extraits"
    ADD CONSTRAINT "extraits_importe_par_id_fkey"
    FOREIGN KEY ("importe_par_id") REFERENCES "utilisateurs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
