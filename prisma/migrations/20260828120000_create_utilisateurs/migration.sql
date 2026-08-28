-- Migration : table `utilisateurs` (ST 4.1 « Inscription »).

-- CreateEnum
CREATE TYPE "StatutUtilisateur" AS ENUM ('ACTIF', 'SUSPENDU');

-- CreateTable
CREATE TABLE "utilisateurs" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mot_de_passe_hash" TEXT NOT NULL,
    "statut" "StatutUtilisateur" NOT NULL DEFAULT 'ACTIF',
    "date_creation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "utilisateurs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- `email` = identifiant de connexion : unicité garantie en base (garde-fou
-- final contre une inscription concurrente sur la même adresse).
CREATE UNIQUE INDEX "utilisateurs_email_key" ON "utilisateurs"("email");
