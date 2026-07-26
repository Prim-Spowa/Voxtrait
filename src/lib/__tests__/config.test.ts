import { afterEach, describe, expect, it } from "vitest";
import { getDataSource, isMockDataSource } from "../config";

// Tests de la bascule mock/API (cf. `.env.example`, `DATA_SOURCE`).

describe("getDataSource", () => {
  const originalValue = process.env.DATA_SOURCE;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.DATA_SOURCE;
    } else {
      process.env.DATA_SOURCE = originalValue;
    }
  });

  it("retourne 'api' par défaut (variable absente)", () => {
    delete process.env.DATA_SOURCE;
    expect(getDataSource()).toBe("api");
  });

  it("retourne 'mock' quand DATA_SOURCE=mock", () => {
    process.env.DATA_SOURCE = "mock";
    expect(getDataSource()).toBe("mock");
  });

  it("ignore la casse et les espaces superflus", () => {
    process.env.DATA_SOURCE = "  MOCK  ";
    expect(getDataSource()).toBe("mock");
  });

  it("retombe sur 'api' pour une valeur non reconnue (ex: typo)", () => {
    process.env.DATA_SOURCE = "mocks";
    expect(getDataSource()).toBe("api");
  });
});

describe("isMockDataSource", () => {
  const originalValue = process.env.DATA_SOURCE;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.DATA_SOURCE;
    } else {
      process.env.DATA_SOURCE = originalValue;
    }
  });

  it("est vrai seulement en mode mock", () => {
    process.env.DATA_SOURCE = "mock";
    expect(isMockDataSource()).toBe(true);

    process.env.DATA_SOURCE = "api";
    expect(isMockDataSource()).toBe(false);
  });
});
