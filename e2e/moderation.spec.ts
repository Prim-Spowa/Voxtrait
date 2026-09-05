import { test } from "@playwright/test";

// ST 11.3 — parcours cœur n°5 : signalement → dashboard de modération (ST 7.1/7.2).
//
// Désactivé (`test.fixme`) : le dashboard exige un compte au rôle MODERATEUR,
// qu'aucune interface ne promeut (cf. README) ; il faut soit un `UPDATE` SQL
// dans une fixture E2E, soit une extension du seed pour un compte modérateur
// de test — à cadrer (cf. dev-note ST 11.3).
test.fixme("signalement anonyme puis traitement en modération", async ({ page }) => {
  // 1. Visiteur anonyme : depuis /doublage/:id (doublage public seedé),
  //    action « Signaler » → POST /api/signalements (201).
  // 2. Se connecter en tant que modérateur (fixture).
  // 3. /admin/moderation : le signalement apparaît dans la file EN_ATTENTE.
  // 4. Action « Retirer le contenu » → contenu en RETRAIT_MODERATION,
  //    signalement RETENU, décision journalisée dans le journal.
  void page;
});
