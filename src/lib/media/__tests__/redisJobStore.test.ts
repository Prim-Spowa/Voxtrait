import { beforeEach, describe, expect, it } from "vitest";
import { createRedisJobStore, RedisJobNotFoundError } from "@/lib/media/redisJobStore";

/**
 * Faux client Redis, hors ligne — implémente seulement le sous-ensemble de
 * l'API `ioredis` utilisé par `createRedisJobStore` (`get`, `mget`, `smembers`,
 * `srem`, et un `multi()` chaînable couvrant `set`/`sadd`/`del`/`exec`). Même
 * principe que les tests hors ligne de `objectStorage.test.ts` (ST 9.2) : pas
 * de dépendance à un vrai serveur pour vérifier la logique du store.
 */
function createFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const sets = new Map<string, Set<string>>();

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
    async get(key: string): Promise<string | null> {
      return isLive(key) ? store.get(key)!.value : null;
    },
    async mget(...keys: string[]): Promise<(string | null)[]> {
      return keys.map((k) => (isLive(k) ? store.get(k)!.value : null));
    },
    async smembers(key: string): Promise<string[]> {
      return Array.from(sets.get(key) ?? []);
    },
    async srem(key: string, ...members: string[]): Promise<number> {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const m of members) if (set.delete(m)) removed += 1;
      return removed;
    },
    /** Aide de test : force l'expiration immédiate d'une clé (simule un TTL Redis écoulé). */
    __expire(key: string) {
      store.delete(key);
    },
    multi() {
      const ops: Array<() => void> = [];
      const chain = {
        set(key: string, value: string, _ex: "EX", ttlSeconds: number) {
          ops.push(() => store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 }));
          return chain;
        },
        sadd(key: string, member: string) {
          ops.push(() => {
            if (!sets.has(key)) sets.set(key, new Set());
            sets.get(key)!.add(member);
          });
          return chain;
        },
        del(key: string) {
          ops.push(() => store.delete(key));
          return chain;
        },
        srem(key: string, member: string) {
          ops.push(() => {
            sets.get(key)?.delete(member);
          });
          return chain;
        },
        async exec() {
          for (const op of ops) op();
          return ops.map(() => [null, "OK"]);
        },
      };
      return chain;
    },
  };

  return api as unknown as import("ioredis").default;
}

interface TestJobInput {
  label: string;
}
interface TestJob {
  id: string;
  updatedAt: string;
  createdAt: string;
  status: string;
  expiresAt?: string;
  input: TestJobInput;
}

function buildStore(redis: ReturnType<typeof createFakeRedis>) {
  return createRedisJobStore<TestJobInput, TestJob>("test", {
    redis,
    keyPrefix: "test-job:",
    buildInitial: (id, ts, input) => ({
      id,
      status: "en_attente",
      createdAt: ts,
      updatedAt: ts,
      input,
    }),
  });
}

describe("createRedisJobStore", () => {
  let redis: ReturnType<typeof createFakeRedis>;

  beforeEach(() => {
    redis = createFakeRedis();
  });

  it("crée un job avec un id généré et le statut initial fourni", async () => {
    const store = buildStore(redis);
    const job = await store.create({ label: "abc" });
    expect(job.id).toMatch(/^test-/);
    expect(job.status).toBe("en_attente");
    expect(job.input).toEqual({ label: "abc" });
  });

  it("get renvoie null pour un id inconnu", async () => {
    const store = buildStore(redis);
    await expect(store.get("inconnu")).resolves.toBeNull();
  });

  it("get relit un job créé", async () => {
    const store = buildStore(redis);
    const created = await store.create({ label: "abc" });
    await expect(store.get(created.id)).resolves.toEqual(created);
  });

  it("update fusionne le patch et rafraîchit updatedAt", async () => {
    const store = buildStore(redis);
    const created = await store.create({ label: "abc" });
    const updated = await store.update(created.id, { status: "pret" });
    expect(updated.status).toBe("pret");
    expect(updated.id).toBe(created.id);
    expect(updated.input).toEqual({ label: "abc" });
  });

  it("update lève RedisJobNotFoundError sur un id inconnu", async () => {
    const store = buildStore(redis);
    await expect(store.update("inconnu", { status: "pret" })).rejects.toThrow(
      RedisJobNotFoundError
    );
  });

  it("list renvoie tous les jobs vivants", async () => {
    const store = buildStore(redis);
    const a = await store.create({ label: "a" });
    const b = await store.create({ label: "b" });
    const list = await store.list();
    expect(list.map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("delete retire le job du store et de l'index", async () => {
    const store = buildStore(redis);
    const job = await store.create({ label: "a" });
    await store.delete(job.id);
    await expect(store.get(job.id)).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });

  it("list nettoie l'index des ids dont la clé a expiré côté Redis (TTL écoulé)", async () => {
    const store = buildStore(redis);
    const job = await store.create({ label: "a" });

    // Simule un TTL Redis écoulé : la clé disparaît du store sous-jacent sans
    // passer par `delete()` — l'id reste dans l'ensemble index jusqu'à ce que
    // `list()` le détecte (via `mget` renvoyant `null`) et le retire.
    (redis as unknown as { __expire(key: string): void }).__expire(`test-job:${job.id}`);

    await expect(store.list()).resolves.toEqual([]);
    await expect(redis.smembers("test-job:index")).resolves.toEqual([]);
  });
});
