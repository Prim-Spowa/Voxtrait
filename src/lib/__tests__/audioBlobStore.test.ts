import { describe, expect, it } from "vitest";
import { createInMemoryAudioBlobStore, isIndexedDbAvailable } from "../audioBlobStore";

// Tests unitaires du stockage temporaire du blob audio (ST 2.1, découpage en
// tâches, point 4). Seule l'implémentation en mémoire est testée ici :
// l'implémentation IndexedDB dépend d'une API navigateur absente de
// l'environnement de test (jsdom) — cf. avertissement dans audioBlobStore.ts.

describe("createInMemoryAudioBlobStore", () => {
  it("retourne null pour un identifiant inconnu", async () => {
    const store = createInMemoryAudioBlobStore();
    expect(await store.load("inconnu")).toBeNull();
  });

  it("sauvegarde puis relit le même blob", async () => {
    const store = createInMemoryAudioBlobStore();
    const blob = new Blob(["voix enregistrée"], { type: "audio/webm" });

    await store.save("session-1", blob);
    const loaded = await store.load("session-1");

    expect(loaded).toBe(blob);
  });

  it("écrase la valeur précédente pour le même identifiant", async () => {
    const store = createInMemoryAudioBlobStore();
    const first = new Blob(["a"], { type: "audio/webm" });
    const second = new Blob(["b"], { type: "audio/webm" });

    await store.save("session-1", first);
    await store.save("session-1", second);

    expect(await store.load("session-1")).toBe(second);
  });

  it("supprime une entrée existante", async () => {
    const store = createInMemoryAudioBlobStore();
    const blob = new Blob(["a"], { type: "audio/webm" });

    await store.save("session-1", blob);
    await store.remove("session-1");

    expect(await store.load("session-1")).toBeNull();
  });

  it("isole les instances de store entre elles", async () => {
    const storeA = createInMemoryAudioBlobStore();
    const storeB = createInMemoryAudioBlobStore();

    await storeA.save("session-1", new Blob(["a"]));

    expect(await storeB.load("session-1")).toBeNull();
  });
});

describe("isIndexedDbAvailable", () => {
  it("ne lève pas d'exception et retourne un booléen (indexedDB absent de jsdom)", () => {
    expect(typeof isIndexedDbAvailable()).toBe("boolean");
  });
});
