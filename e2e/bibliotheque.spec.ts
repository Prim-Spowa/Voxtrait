import { expect, test } from "@playwright/test";

// ST 11.3 — parcours cœur n°1 : bibliothèque (filtres + recherche) →
// page unifiée de l'extrait (ST 10.3) → surface d'export (ST 10.4).
//
// S'appuie sur le jeu de données de démonstration (`npm run db:seed`) :
//   - « L'Odyssée Stellaire — Pilote » : origine FR, type SERIE, EMBED, VALIDE
//   - « Sakura no Machi »               : origine JP (« Japon »)

test.describe("Bibliothèque → extrait → export", () => {
  test("recherche par titre puis ouverture de la page de l'extrait", async ({
    page,
  }) => {
    await page.goto("/bibliotheque");

    await expect(
      page.getByRole("heading", { name: "Bibliothèque" }),
    ).toBeVisible();

    // Recherche texte (debounce côté client). Un seul champ `searchbox` sur
    // la page (aucune recherche dans l'en-tête).
    await page.getByRole("searchbox").fill("Odyssée");

    const resultats = page.getByRole("region", {
      name: "Résultats de la bibliothèque",
    });
    await expect(
      resultats.getByRole("link", { name: /Odyssée Stellaire/ }),
    ).toBeVisible();
    await expect(resultats.getByText("Réverbérations")).toHaveCount(0);

    await resultats
      .getByRole("link", { name: /Odyssée Stellaire/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/extraits\/mock-001/);
    await expect(
      page.getByRole("heading", { name: "L'Odyssée Stellaire — Pilote" }),
    ).toBeVisible();
  });

  test("filtre par origine (Japon)", async ({ page }) => {
    await page.goto("/bibliotheque");

    // Les filtres sont des boutons `aria-pressed` dans la colonne `<nav>`.
    await page
      .getByRole("navigation", { name: "Filtrer la bibliothèque d'extraits" })
      .getByRole("button", { name: "Japon" })
      .click();

    const resultats = page.getByRole("region", {
      name: "Résultats de la bibliothèque",
    });
    await expect(resultats.getByText("Sakura no Machi")).toBeVisible();
    await expect(
      resultats.getByRole("link", { name: /Odyssée Stellaire/ }),
    ).toHaveCount(0);
  });

  test("la page de l'extrait expose la surface d'export", async ({ page }) => {
    await page.goto("/extraits/mock-001");

    await expect(
      page.getByRole("heading", { name: "L'Odyssée Stellaire — Pilote" }),
    ).toBeVisible();
    // ST 10.4 — la surface d'export (`DoublageExport`) est présente sur la
    // page publique de l'extrait. Le bouton n'apparaît qu'après un
    // enregistrement ; on vérifie le panneau et son invite.
    await expect(page.getByTestId("doublage-export")).toBeVisible();
    await expect(
      page.getByText("Terminez un enregistrement pour pouvoir générer"),
    ).toBeVisible();
  });
});
