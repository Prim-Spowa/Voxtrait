-- Migration : table `script_lignes` (ST 1.3 "Synchronisation script/dialogue").

-- CreateTable
CREATE TABLE "script_lignes" (
    "id" TEXT NOT NULL,
    "extrait_id" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "timestamp_debut" DOUBLE PRECISION NOT NULL,
    "timestamp_fin" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "script_lignes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Lecture triée par ordre d'apparition, filtrée par extrait (cf.
-- `listScriptLignes` dans `src/lib/script.ts`).
CREATE INDEX "script_lignes_extrait_id_timestamp_debut_idx" ON "script_lignes"("extrait_id", "timestamp_debut");

-- AddForeignKey
ALTER TABLE "script_lignes" ADD CONSTRAINT "script_lignes_extrait_id_fkey" FOREIGN KEY ("extrait_id") REFERENCES "extraits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
