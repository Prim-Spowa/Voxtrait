import { describe, expect, it } from "vitest";
import { buildExtraitApiUrl, buildExtraitsApiUrl } from "../extraitsClient";

describe("buildExtraitsApiUrl", () => {
  it("retourne l'URL de base sans paramètres si aucun filtre actif", () => {
    expect(buildExtraitsApiUrl({})).toBe("/api/extraits");
  });

  it("inclut origine, type et q si renseignés", () => {
    const url = buildExtraitsApiUrl({ origine: "FR", type: "FILM", q: "matrix" });
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("origine")).toBe("FR");
    expect(params.get("type")).toBe("FILM");
    expect(params.get("q")).toBe("matrix");
  });

  it("ignore les filtres vides (chaîne vide)", () => {
    const url = buildExtraitsApiUrl({ origine: "", type: "", q: "" });
    expect(url).toBe("/api/extraits");
  });

  it("supprime les espaces superflus de la recherche", () => {
    const url = buildExtraitsApiUrl({ q: "  totoro  " });
    expect(url).toContain("q=totoro");
  });

  it("n'inclut pas page=1 (valeur implicite)", () => {
    const url = buildExtraitsApiUrl({ page: 1 });
    expect(url).toBe("/api/extraits");
  });

  it("inclut page si > 1", () => {
    const url = buildExtraitsApiUrl({ page: 4 });
    expect(url).toBe("/api/extraits?page=4");
  });
});

describe("buildExtraitApiUrl", () => {
  // ST 10.3 — page publique unifiée d'un extrait.
  it("construit l'URL de détail d'un extrait", () => {
    expect(buildExtraitApiUrl("extrait-1")).toBe("/api/extraits/extrait-1");
  });

  it("encode l'id dans l'URL", () => {
    expect(buildExtraitApiUrl("id avec espace")).toBe("/api/extraits/id%20avec%20espace");
  });
});
