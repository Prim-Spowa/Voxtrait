import { test } from "@playwright/test";

// ST 11.3 — parcours cœur n°3 : import + certification des droits (ST 5.1/5.2).
//
// Désactivé (`test.fixme`) : nécessite le worker BullMQ (`npm run worker`) en
// parallèle du serveur et une fixture de fichier vidéo ≤ 5 min. L'outillage
// (démarrage du worker par Playwright, vidéo de test versionnée ou générée par
// FFmpeg) est à cadrer — cf. Claude output/dev-note/dev-notes-ST11.3-env-dev-test.md.
test.fixme("import d'une vidéo avec certification des droits", async ({ page }) => {
  // 1. Se connecter (helper d'auth partagé à extraire) et accepter les CGU.
  // 2. Aller sur /import, remplir titre/origine/type, cocher la certification
  //    des droits, sélectionner la vidéo fixture.
  // 3. POST /api/import/upload-url → PUT du fichier → POST /api/import.
  // 4. Attendre que GET /api/import/:id passe à `pret` (worker requis).
  // 5. Vérifier la création de l'extrait au statut EN_ATTENTE.
  // 6. Cas limite : vidéo > 5 min → 422 + fichier supprimé du stockage.
  void page;
});
