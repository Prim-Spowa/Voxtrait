import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// ST 11.3 — `.env.test` (versionné : base `fandub_test`, MinIO local, secrets
// de test) est la source unique de configuration de test, partagée local / CI.
// Petit parseur maison pour éviter une dépendance `dotenv` et ne pas dépendre
// de `NODE_ENV` (que `next dev` réécrit en « development »).
function chargeEnvTest(): Record<string, string> {
  const fichier = path.join(process.cwd(), ".env.test");
  const vars: Record<string, string> = {};
  if (!fs.existsSync(fichier)) return vars;
  for (const ligne of fs.readFileSync(fichier, "utf8").split("\n")) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const envTest = chargeEnvTest();
// Rend les variables disponibles à la config elle-même (baseURL, etc.).
for (const [cle, valeur] of Object.entries(envTest)) {
  process.env[cle] = process.env[cle] ?? valeur;
}

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Un seul worker : les scénarios partagent la base `fandub_test` seedée et
  // certains créent des comptes / signalements. Paralléliser demanderait une
  // isolation par test encore à cadrer (cf. dev-note ST 11.3).
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Démarre l'application sur un port dédié. Prérequis (non gérés ici) :
  // `docker compose up -d` + base `fandub_test` migrée et seedée. La CI s'en
  // charge dans un job séparé (`.github/workflows/ci.yml`).
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: envTest,
  },
});
