import { test } from "@playwright/test";

// ST 11.3 — parcours cœur n°6 : demande de retrait → rapport des délais (ST 7.3).
//
// Désactivé (`test.fixme`) : la partie « rapport des délais » de
// /admin/demandes-retrait exige un compte MODERATEUR (même contrainte que
// moderation.spec.ts). La soumission publique du formulaire, elle, est
// testable seule — à activer une fois la fixture modérateur en place.
test.fixme("demande de retrait puis rapport des délais", async ({ page }) => {
  // 1. Public : /demande-retrait?type=EXTRAIT&id=mock-001, remplir identité,
  //    œuvre, exposé, cocher la déclaration de bonne foi → 201.
  // 2. Se connecter en tant que modérateur (fixture).
  // 3. /admin/demandes-retrait : la demande est dans la file EN_ATTENTE.
  // 4. Action « Retirer le contenu » → statut RETRAIT_AYANT_DROIT, demande
  //    TRAITEE, décision dédiée journalisée.
  // 5. GET /api/admin/demandes-retrait/rapport : les compteurs et délais
  //    (moyen / médian / max, respect du délai cible 72 h) sont cohérents.
  void page;
});
