import { expect, test } from "@playwright/test";

// ST 11.3 — parcours cœur n°2 : inscription → session connectée (nom affiché
// dans l'en-tête, ST 10.2) → déconnexion (session réellement révoquée,
// ST 9.4).
//
// Chaque exécution crée un compte à e-mail unique dans la base `fandub_test`.
// L'isolation/purge de ces comptes entre exécutions reste à cadrer
// (cf. dev-note ST 11.3) ; l'e-mail horodaté évite les collisions `409`.

test("inscription puis déconnexion", async ({ page }) => {
  const email = `e2e+${Date.now()}@example.test`;
  const motDePasse = "Doublage-E2E-2026!";

  await page.goto("/inscription");

  const form = page.getByTestId("register-form");
  await form.getByLabel("Adresse e-mail").fill(email);
  await form.getByLabel("Nom", { exact: true }).fill("Testeur");
  await form.getByLabel("Prénom", { exact: true }).fill("Éva");
  await form.getByLabel("Âge", { exact: true }).fill("30");
  await form.getByLabel("Mot de passe", { exact: true }).fill(motDePasse);
  await form.getByLabel("Confirmer le mot de passe").fill(motDePasse);
  await form.getByRole("checkbox").check();

  await form.getByRole("button", { name: "Créer mon compte" }).click();

  // Confirmation d'inscription + session posée.
  await expect(page.getByText("Compte créé")).toBeVisible();

  await page.goto("/bibliotheque");
  // ST 10.2 — le nom du compte connecté apparaît dans l'en-tête, à côté du
  // bouton de déconnexion.
  await expect(
    page.getByRole("button", { name: "Se déconnecter" }),
  ).toBeVisible();
  await expect(page.getByText("Éva Testeur").first()).toBeVisible();

  // ST 9.4 — déconnexion : la session est révoquée côté serveur ; l'en-tête
  // repasse à l'état anonyme.
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();

  // Une route protégée redirige alors vers la connexion.
  await page.goto("/mon-espace/favoris");
  await expect(page).toHaveURL(/\/connexion/);
});
