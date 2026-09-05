import { test } from "@playwright/test";

// ST 11.3 — parcours cœur n°4 : favoris / historique → doublage (ST 11.2).
//
// Désactivé (`test.fixme`) : nécessite un compte seedé avec au moins un favori
// et un doublage sauvegardé dans `fandub_test`. Le seed de démonstration ne
// crée pas de compte utilisateur — fixture E2E à cadrer (cf. dev-note ST 11.3).
test.fixme("favoris → page de l'extrait puis doublage", async ({ page }) => {
  // 1. Se connecter (compte fixture avec un favori sur mock-001).
  // 2. /mon-espace/favoris : la carte de l'extrait VALIDE est un lien vers
  //    /extraits/mock-001 (ST 11.2) ; le clic favori ne déclenche pas la
  //    navigation (stopPropagation).
  // 3. Un extrait favori retiré affiche le badge « Contenu retiré » sans lien.
  // 4. /mon-espace/historique : l'action « Doubler à nouveau » pointe vers
  //    /extraits/:id ; masquée si l'extrait a disparu ou est retiré.
  void page;
});
