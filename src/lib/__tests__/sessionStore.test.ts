import { describe, expect, it } from "vitest";
import {
  createInMemorySessionStore,
  createRedisSessionStore,
  type SessionStore,
} from "../sessionStore";

/**
 * ST 9.4 « Persistance des sessions et du rate limiting ».
 *
 * Les deux implémentations (`createInMemorySessionStore`,
 * `createRedisSessionStore`) partagent le même contrat (`SessionStore`) : la
 * suite `describe.each` les exerce identiquement, comme
 * `redisJobStore.test.ts` (ST 9.3) le fait pour `RedisJobStore`. Le faux
 * client Redis ci-dessous est hors ligne — même principe que
 * `redisJobStore.test.ts` : pas de dépendance à un vrai serveur pour vérifier
 * la logique du store.
 */
function createFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function isLive(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return false;
    }
    return true;
  }

  const api = {
    async set(key: string, value: string, _ex: "EX", ttlSeconds: number): Promise<"OK"> {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return "OK";
    },
    async exists(key: string): Promise<number> {
      return isLive(key) ? 1 : 0;
    },
    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0;
    },
    /** Aide de test : force l'expiration immédiate d'une clé (simule un TTL Redis écoulé). */
    __expire(key: string) {
      store.delete(key);
    },
  };

  return api as unknown as import("ioredis").default;
}

const implementations: Array<[string, () => SessionStore]> = [
  ["createInMemorySessionStore", () => createInMemorySessionStore()],
  ["createRedisSessionStore", () => createRedisSessionStore(createFakeRedis())],
];

describe.each(implementations)("%s", (_name, createStore) => {
  it("isActive() renvoie false pour une session jamais enregistrée", async () => {
    const store = createStore();
    expect(await store.isActive("jti-inconnu")).toBe(false);
  });

  it("register() puis isActive() renvoie true pour la même session", async () => {
    const store = createStore();
    await store.register("jti-1", "user-1", 60);
    expect(await store.isActive("jti-1")).toBe(true);
  });

  it("revoke() rend la session inactive (déconnexion)", async () => {
    const store = createStore();
    await store.register("jti-1", "user-1", 60);
    await store.revoke("jti-1");
    expect(await store.isActive("jti-1")).toBe(false);
  });

  it("revoke() est idempotent (pas d'erreur sur une session absente)", async () => {
    const store = createStore();
    await expect(store.revoke("jamais-enregistree")).resolves.toBeUndefined();
  });

  it("des sessions distinctes sont indépendantes", async () => {
    const store = createStore();
    await store.register("jti-a", "user-a", 60);
    await store.register("jti-b", "user-b", 60);
    await store.revoke("jti-a");
    expect(await store.isActive("jti-a")).toBe(false);
    expect(await store.isActive("jti-b")).toBe(true);
  });
});

describe("createInMemorySessionStore", () => {
  it("expire une session au bout de `ttlSeconds` (horloge injectée)", async () => {
    let current = 0;
    const store = createInMemorySessionStore(() => current);
    await store.register("jti-1", "user-1", 60);

    current = 59_000;
    expect(await store.isActive("jti-1")).toBe(true);

    current = 60_000;
    expect(await store.isActive("jti-1")).toBe(false);
  });
});
