import { describe, expect, it } from "vitest";
import {
  buildDoublagePublicPath,
  buildShareLinks,
  buildShareText,
  buildWebSharePayload,
  canUseWebShare,
  isShareAbortError,
  resolveDoublageShareUrl,
  SHARE_NETWORKS,
} from "../doublageShareClient";

// ST 3.2 — logique client-safe du partage : lien public, Web Share API,
// liens d'intent par réseau.

describe("buildDoublagePublicPath / resolveDoublageShareUrl", () => {
  it("construit un chemin relatif vers /doublage/:id", () => {
    expect(buildDoublagePublicPath("abc-123")).toBe("/doublage/abc-123");
  });

  it("échappe l'id", () => {
    expect(buildDoublagePublicPath("a/b?c")).toBe("/doublage/a%2Fb%3Fc");
  });

  it("préfixe par l'origine sans double slash", () => {
    expect(resolveDoublageShareUrl("https://voxtrait.test/", "job-1")).toBe(
      "https://voxtrait.test/doublage/job-1"
    );
    expect(resolveDoublageShareUrl("https://voxtrait.test", "job-1")).toBe(
      "https://voxtrait.test/doublage/job-1"
    );
  });

  it("retombe sur le chemin relatif si l'origine est absente", () => {
    expect(resolveDoublageShareUrl(null, "job-1")).toBe("/doublage/job-1");
    expect(resolveDoublageShareUrl("", "job-1")).toBe("/doublage/job-1");
  });
});

describe("buildShareText", () => {
  it("cite le titre de l'extrait quand il est fourni", () => {
    expect(buildShareText("Réverbérations")).toContain("« Réverbérations »");
  });

  it("retombe sur une formule générique sans titre", () => {
    expect(buildShareText(null)).toMatch(/un extrait/i);
    expect(buildShareText("  ")).toMatch(/un extrait/i);
  });
});

describe("canUseWebShare", () => {
  it("false si navigator est absent ou sans share", () => {
    expect(canUseWebShare(undefined)).toBe(false);
    expect(canUseWebShare({})).toBe(false);
  });

  it("true si share existe et pas de canShare", () => {
    expect(canUseWebShare({ share: async () => {} })).toBe(true);
  });

  it("consulte canShare avec le payload quand il est présent", () => {
    const payload = { url: "https://x.test" };
    expect(
      canUseWebShare({ share: async () => {}, canShare: () => false }, payload)
    ).toBe(false);
    expect(
      canUseWebShare({ share: async () => {}, canShare: () => true }, payload)
    ).toBe(true);
  });

  it("false si canShare lève", () => {
    expect(
      canUseWebShare(
        {
          share: async () => {},
          canShare: () => {
            throw new Error("nope");
          },
        },
        { url: "x" }
      )
    ).toBe(false);
  });
});

describe("buildWebSharePayload", () => {
  it("inclut titre, texte et url", () => {
    const payload = buildWebSharePayload({
      extraitTitre: "Réverbérations",
      shareUrl: "https://voxtrait.test/doublage/j1",
    });
    expect(payload.title).toContain("Réverbérations");
    expect(payload.url).toBe("https://voxtrait.test/doublage/j1");
    expect(payload.text).toBeTruthy();
  });
});

describe("isShareAbortError", () => {
  it("reconnaît une annulation utilisateur", () => {
    const err = new Error("The user aborted a request.");
    err.name = "AbortError";
    expect(isShareAbortError(err)).toBe(true);
    expect(isShareAbortError(new Error("share canceled"))).toBe(true);
  });

  it("laisse passer les vraies erreurs", () => {
    expect(isShareAbortError(new Error("network"))).toBe(false);
    expect(isShareAbortError("nope")).toBe(false);
  });
});

describe("buildShareLinks", () => {
  const links = buildShareLinks({
    shareUrl: "https://voxtrait.test/doublage/j1",
    extraitTitre: "Réverbérations",
  });

  it("produit une entrée par réseau du registre", () => {
    expect(links.map((l) => l.id)).toEqual(SHARE_NETWORKS.map((n) => n.id));
  });

  it("encode l'URL de partage dans chaque lien", () => {
    const encoded = encodeURIComponent("https://voxtrait.test/doublage/j1");
    for (const link of links) {
      expect(link.url).toContain(encoded);
    }
  });

  it("génère un mailto: pour l'e-mail", () => {
    const email = links.find((l) => l.id === "email");
    expect(email?.url.startsWith("mailto:?")).toBe(true);
    expect(email?.url).toContain("subject=");
  });

  it("pointe X et Facebook vers leurs endpoints de partage", () => {
    expect(links.find((l) => l.id === "x")?.url).toContain("twitter.com/intent/tweet");
    expect(links.find((l) => l.id === "facebook")?.url).toContain("facebook.com/sharer");
  });
});
