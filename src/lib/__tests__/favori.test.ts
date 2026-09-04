import { beforeEach, describe, expect, it } from "vitest";
import {
  ajouterFavori,
  chargerFavoris,
  createInMemoryFavoriStore,
  retirerFavori,
  toFavoriView,
  type FavoriStore,
  type ResolveExtraitResumeFavori,
} from "../favori";

// ST 8.1, Definition of Done technique : « Tests unitaires sur le toggle
// (ajout/retrait, idempotence) et le contrôle d'accès ; tests sur le listing
// paginé ».

const OWNER = "mock-user-001";
const TIERS = "mock-user-002";

describe("ajouterFavori", () => {
  let store: FavoriStore;

  beforeEach(() => {
    store = createInMemoryFavoriStore();
  });

  it("crée une entrée liant le compte à l'extrait", async () => {
    const favori = await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });

    expect(favori.utilisateurId).toBe(OWNER);
    expect(favori.extraitId).toBe("mock-002");
    expect(favori.id).toBeTruthy();
    expect(favori.dateAjout).toBeTruthy();
  });

  it("est idempotent : deux ajouts du même couple ne créent qu'une entrée", async () => {
    const first = await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });
    const second = await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });

    expect(second.id).toBe(first.id);
    const { total } = await store.pageByUtilisateur(OWNER, { skip: 0, take: 10 });
    expect(total).toBe(1);
  });

  it("permet à deux comptes différents de favoriser le même extrait", async () => {
    const forOwner = await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });
    const forTiers = await ajouterFavori(store, { utilisateurId: TIERS, extraitId: "mock-002" });

    expect(forOwner.id).not.toBe(forTiers.id);
  });

  it("permet à un même compte de favoriser plusieurs extraits distincts", async () => {
    await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-001" });
    await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });

    const { total } = await store.pageByUtilisateur(OWNER, { skip: 0, take: 10 });
    expect(total).toBe(2);
  });

  it("refuse un identifiant utilisateur vide", async () => {
    await expect(
      ajouterFavori(store, { utilisateurId: "   ", extraitId: "mock-002" })
    ).rejects.toThrow(/identifiant utilisateur/i);
  });

  it("refuse un identifiant extrait vide", async () => {
    await expect(
      ajouterFavori(store, { utilisateurId: OWNER, extraitId: "   " })
    ).rejects.toThrow(/identifiant extrait/i);
  });

  it("gère une course : deux ajouts concurrents du même couple ne créent qu'une entrée", async () => {
    // Simule la course en insérant directement (contourne le `find` préalable
    // d'`ajouterFavori`, comme le ferait un deuxième appel concurrent).
    const concurrent = createInMemoryFavoriStore();
    await concurrent.create({ utilisateurId: OWNER, extraitId: "mock-002" });

    const resultat = await ajouterFavori(concurrent, {
      utilisateurId: OWNER,
      extraitId: "mock-002",
    });
    expect(resultat.utilisateurId).toBe(OWNER);
    const { total } = await concurrent.pageByUtilisateur(OWNER, { skip: 0, take: 10 });
    expect(total).toBe(1);
  });
});

describe("retirerFavori", () => {
  let store: FavoriStore;

  beforeEach(() => {
    store = createInMemoryFavoriStore();
  });

  it("retire un favori existant et renvoie true", async () => {
    await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });

    const removed = await retirerFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });
    expect(removed).toBe(true);
    const { total } = await store.pageByUtilisateur(OWNER, { skip: 0, take: 10 });
    expect(total).toBe(0);
  });

  it("est idempotent : retirer un favori déjà absent renvoie false sans erreur", async () => {
    await expect(
      retirerFavori(store, { utilisateurId: OWNER, extraitId: "inexistant" })
    ).resolves.toBe(false);
  });

  it("ne retire pas le favori d'un autre compte pour le même extrait", async () => {
    await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });
    await ajouterFavori(store, { utilisateurId: TIERS, extraitId: "mock-002" });

    await retirerFavori(store, { utilisateurId: TIERS, extraitId: "mock-002" });

    const { total: totalOwner } = await store.pageByUtilisateur(OWNER, { skip: 0, take: 10 });
    const { total: totalTiers } = await store.pageByUtilisateur(TIERS, { skip: 0, take: 10 });
    expect(totalOwner).toBe(1);
    expect(totalTiers).toBe(0);
  });

  it("renvoie false pour un identifiant utilisateur ou extrait vide", async () => {
    await expect(retirerFavori(store, { utilisateurId: "  ", extraitId: "mock-002" })).resolves.toBe(
      false
    );
    await expect(retirerFavori(store, { utilisateurId: OWNER, extraitId: "  " })).resolves.toBe(
      false
    );
  });
});

describe("chargerFavoris — endpoint de listing paginé (ST 8.1)", () => {
  const OTHER = "mock-user-003";

  /** Résout un extrait mocké : le titre reprend l'id, sauf `mock-404` (introuvable). */
  const resolveExtrait: ResolveExtraitResumeFavori = async (extraitId) => {
    if (extraitId === "mock-404") return null;
    return {
      titre: `Titre ${extraitId}`,
      thumbnail: `https://img.test/${extraitId}.jpg`,
      origine: "FR",
      type: "FILM",
      source: "EMBED",
      statut: extraitId === "mock-retire" ? "RETRAIT_MODERATION" : "VALIDE",
    };
  };

  /** Store rempli de `count` favoris pour OWNER (dates croissantes). */
  async function storeAvec(count: number, extraitIds?: string[]) {
    let tick = 0;
    const store = createInMemoryFavoriStore(() => new Date(2026, 0, 1, 0, 0, tick++));
    for (let i = 0; i < count; i++) {
      await store.create({
        utilisateurId: OWNER,
        extraitId: extraitIds?.[i] ?? `mock-${String(i).padStart(3, "0")}`,
      });
    }
    return store;
  }

  it("renvoie la première page, les plus récents d'abord, enrichis de l'extrait", async () => {
    const store = await storeAvec(3, ["mock-a", "mock-b", "mock-c"]);

    const res = await chargerFavoris(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 2,
      resolveExtrait,
    });

    expect(res.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(res.items.map((i) => i.extraitId)).toEqual(["mock-c", "mock-b"]);
    expect(res.items[0]).toMatchObject({
      extraitTitre: "Titre mock-c",
      extraitThumbnail: "https://img.test/mock-c.jpg",
      extraitOrigine: "FR",
      extraitType: "FILM",
      extraitSource: "EMBED",
      extraitStatut: "VALIDE",
    });
    // La vue n'expose pas l'utilisateurId (ST 8.1, même posture que ST 6.1).
    expect(res.items[0]).not.toHaveProperty("utilisateurId");
  });

  it("pagine correctement la dernière page", async () => {
    const store = await storeAvec(3);
    const res = await chargerFavoris(store, {
      utilisateurId: OWNER,
      page: 2,
      pageSize: 2,
      resolveExtrait,
    });
    expect(res.items).toHaveLength(1);
    expect(res.pagination.page).toBe(2);
  });

  it("borne une page hors limite à la dernière page plutôt que d'échouer", async () => {
    const store = await storeAvec(2);
    const res = await chargerFavoris(store, {
      utilisateurId: OWNER,
      page: 99,
      pageSize: 10,
      resolveExtrait,
    });
    expect(res.pagination.page).toBe(1);
    expect(res.items).toHaveLength(2);
  });

  it("ne renvoie jamais les favoris d'un autre compte (contrôle d'accès)", async () => {
    const store = await storeAvec(2);
    await store.create({ utilisateurId: OTHER, extraitId: "mock-x" });

    const res = await chargerFavoris(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 50,
      resolveExtrait,
    });
    expect(res.pagination.total).toBe(2);
    expect(res.items.every((i) => i.extraitId !== "mock-x")).toBe(true);
  });

  it("tolère un extrait introuvable (champs extrait à null)", async () => {
    const store = await storeAvec(1, ["mock-404"]);
    const res = await chargerFavoris(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 10,
      resolveExtrait,
    });
    expect(res.items[0]).toMatchObject({
      extraitTitre: null,
      extraitThumbnail: null,
      extraitOrigine: null,
      extraitType: null,
      extraitStatut: null,
    });
  });

  it("expose le statut d'un extrait retiré plutôt que de perdre le favori (ST 8.1)", async () => {
    const store = await storeAvec(1, ["mock-retire"]);
    const res = await chargerFavoris(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 10,
      resolveExtrait,
    });
    // Le favori survit à l'extrait retiré : titre/vignette encore connus, et
    // le statut permet à l'affichage de distinguer "retiré" de "introuvable".
    expect(res.items[0]).toMatchObject({
      extraitTitre: "Titre mock-retire",
      extraitStatut: "RETRAIT_MODERATION",
    });
  });

  it("ne résout chaque extrait distinct qu'une fois", async () => {
    const store = await storeAvec(1, ["mock-same"]);
    // Ajoute un deuxième favori du même extrait pour un autre utilisateur —
    // ne doit pas provoquer de résolution supplémentaire pour OWNER.
    await store.create({ utilisateurId: OWNER, extraitId: "mock-same-2" });
    let calls = 0;
    await chargerFavoris(store, {
      utilisateurId: OWNER,
      page: 1,
      pageSize: 10,
      resolveExtrait: async (id) => {
        calls++;
        return { titre: id, thumbnail: null, origine: null, type: null, source: null, statut: null };
      },
    });
    expect(calls).toBe(2);
  });

  it("renvoie une page vide pour un identifiant utilisateur vide", async () => {
    const store = await storeAvec(2);
    const res = await chargerFavoris(store, {
      utilisateurId: "   ",
      page: 1,
      pageSize: 10,
      resolveExtrait,
    });
    expect(res.items).toEqual([]);
    expect(res.pagination.total).toBe(0);
  });
});

describe("toFavoriView", () => {
  it("n'expose ni utilisateurId", async () => {
    const store = createInMemoryFavoriStore();
    const favori = await ajouterFavori(store, { utilisateurId: OWNER, extraitId: "mock-002" });

    const view = toFavoriView(favori);
    expect(view).toEqual({
      id: favori.id,
      extraitId: "mock-002",
      dateAjout: favori.dateAjout,
    });
    expect(view).not.toHaveProperty("utilisateurId");
  });
});
