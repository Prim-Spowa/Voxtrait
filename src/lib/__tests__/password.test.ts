import { describe, expect, it } from "vitest";
import { createScryptPasswordHasher } from "../password";

// ST 4.1 — hachage du mot de passe (scrypt, cf. écart assumé documenté dans
// `lib/password.ts`). Tests volontairement peu nombreux : scrypt aux
// paramètres de production coûte ~50-100 ms par appel.

describe("createScryptPasswordHasher", () => {
  const hasher = createScryptPasswordHasher();

  it("produit un hash auto-décrivant, différent du mot de passe en clair", async () => {
    const stored = await hasher.hash("Corr3ct-horse-battery");
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain("Corr3ct-horse-battery");
  });

  it("génère un sel différent à chaque appel (hashes distincts)", async () => {
    const [a, b] = await Promise.all([hasher.hash("meme-mot-de-passe-1"), hasher.hash("meme-mot-de-passe-1")]);
    expect(a).not.toBe(b);
  });

  it("verify() accepte le bon mot de passe et rejette les autres", async () => {
    const stored = await hasher.hash("Corr3ct-horse-battery");
    expect(await hasher.verify("Corr3ct-horse-battery", stored)).toBe(true);
    expect(await hasher.verify("mauvais-mot-de-passe", stored)).toBe(false);
  });

  it("verify() renvoie false sur une valeur stockée corrompue plutôt que de lever", async () => {
    expect(await hasher.verify("x", "pas-un-hash")).toBe(false);
    expect(await hasher.verify("x", "scrypt$abc")).toBe(false);
    expect(await hasher.verify("x", "")).toBe(false);
  });

  it("refuse de hacher un mot de passe vide", async () => {
    await expect(hasher.hash("")).rejects.toThrow();
  });
});
