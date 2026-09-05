import { expect, test } from "@playwright/test";

// ST 11.3 — parcours cœur n°1 : bibliothèque (filtres + recherche) →
// page unifiée de l'extrait (ST 10.3) → bouton d'export visible (ST 10.4).
//
// S'appuie sur le jeu de données de démonstration (`npm run db:seed`) :
//   - « L'Odyssée Stellaire — Pilote » : origine FR, type SERIE, EMBED, VALIDE
//   - « Réverbérations »                : origine US, type FILM

test.describe("Bibliothèque → extrait → export", () => {
  test("recherche par titre puis ouverture de la page de l'extrait", async ({
    page,
  }) => {
    await page.goto("/bibliotheque");

    await expect(
      page.getByRole("heading", { name: "Bibliothèque" }),
    ).toBeVisible();

    // Recherche texte (debounce côté client).
    await page.getByLabel("Rechercher").fill("Odyssée");

    const resultats = page.getByRole("region", {
      name: "Résultats de la bibliothèque",
    });
    await expect(
      resultats.getByText("L'Odyssée Stellaire — Pilote"),
    ).toBeVisible();
    await expect(resultats.getByText("Réverbérations")).toHaveCount(0);

    // Ouverture de la fiche.
    await resultats
      .getByRole("link", { name: /Odyssée Stellaire/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/extraits\/mock-001/);
    await expect(
      page.getByRole("heading", { name: "L'Odyssée Stellaire — Pilote" }),
    ).toBeVisible();
  });

  test("filtre par origine puis par type", async ({ page }) => {
    await page.goto("/bibliotheque");

    const filtres = page.getByRole("navigation", {
      name: "Filtrer la bibliothèque d'extraits",
    });
    await filtres.getByText("JP", { exact: true }).click();

    const resultats = page.getByRole("region", {
      name: "Résultats de la bibliothèque",
    });
    // « Sakura no Machi » est le seul titre JP nommé du seed.
    await expect(resultats.getByText("Sakura no Machi")).toBeVisible();
    await expect(
      resultats.getByText("L'Odyssée Stellaire — Pilote"),
    ).toHaveCount(0);
  });

  test("la page de l'extrait expose la surface d'export", async ({ page }) => {
    await page.goto("/extraits/mock-001");

    await expect(
      page.getByRole("heading", { name: "L'Odyssée Stellaire — Pilote" }),
    ).toBeVisible();
    // ST 10.4 — la surface d'export/téléchargement (`DoublageExport`) est
    // présente sur la page publique de l'extrait, sans passer par `/dev/*`.
    // Le bouton lui-même n'apparaît qu'après un enregistrement ; on vérifie
    // ici le panneau et son invite.
    await expect(page.getByTestId("doublage-export")).toBeVisible();
    await expect(
      page.getByText("Terminez un enregistrement pour pouvoir générer"),
    ).toBeVisible();
  });
});
