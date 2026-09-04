import { beforeEach, describe, expect, it, vi } from "vitest";

const { addMock, queueCtorMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  queueCtorMock: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(...args: unknown[]) {
      queueCtorMock(...args);
    }
    add = addMock;
  },
}));

vi.mock("@/lib/media/redisConnection", () => ({
  getRedisClient: () => ({ fake: "redis-client" }),
}));

describe("jobQueues", () => {
  beforeEach(() => {
    vi.resetModules();
    addMock.mockReset();
    queueCtorMock.mockReset();
    // Les files sont mises en cache sur `globalThis` (cf. `jobQueues.ts`,
    // même pattern que `src/lib/prisma.ts`) : `vi.resetModules()` ne
    // réinitialise pas `globalThis`, donc chaque test repart d'un état propre
    // en supprimant explicitement les entrées posées par le test précédent.
    delete (globalThis as Record<string, unknown>).importCompressionQueue;
    delete (globalThis as Record<string, unknown>).doublageMixQueue;
  });

  it("enqueueImportCompressionJob ajoute un job { jobId } à la file d'import", async () => {
    const { enqueueImportCompressionJob, IMPORT_COMPRESSION_QUEUE_NAME } = await import(
      "@/lib/media/jobQueues"
    );
    await enqueueImportCompressionJob("import-42");
    expect(queueCtorMock).toHaveBeenCalledWith(
      IMPORT_COMPRESSION_QUEUE_NAME,
      expect.objectContaining({ connection: { fake: "redis-client" } })
    );
    expect(addMock).toHaveBeenCalledWith("compress", { jobId: "import-42" });
  });

  it("enqueueDoublageMixJob ajoute un job { jobId } à la file de mixage", async () => {
    const { enqueueDoublageMixJob, DOUBLAGE_MIX_QUEUE_NAME } = await import(
      "@/lib/media/jobQueues"
    );
    await enqueueDoublageMixJob("doublage-7");
    expect(queueCtorMock).toHaveBeenCalledWith(
      DOUBLAGE_MIX_QUEUE_NAME,
      expect.objectContaining({ connection: { fake: "redis-client" } })
    );
    expect(addMock).toHaveBeenCalledWith("mix", { jobId: "doublage-7" });
  });

  it("réutilise la même instance de file entre deux appels (singleton globalThis)", async () => {
    const { getImportCompressionQueue } = await import("@/lib/media/jobQueues");
    const first = getImportCompressionQueue();
    const second = getImportCompressionQueue();
    expect(first).toBe(second);
    expect(queueCtorMock).toHaveBeenCalledTimes(1);
  });
});
