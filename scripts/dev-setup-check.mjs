// ST 11.3 — rappel de fin de `npm run dev:setup` : vérifie que les services
// de `docker-compose.yml` répondent et rappelle les prérequis binaires hors
// Docker (FFmpeg/ffprobe, worker). Purement informatif : n'échoue jamais, la
// migration et le seed ont déjà tourné à ce stade.
import net from "node:net";
import { execFileSync } from "node:child_process";

const SERVICES = [
  { nom: "PostgreSQL", hote: "127.0.0.1", port: 5432 },
  { nom: "Redis", hote: "127.0.0.1", port: 6379 },
  { nom: "MinIO (S3)", hote: "127.0.0.1", port: 9000 },
];

/** Teste l'ouverture d'une socket TCP (timeout 1 s). */
function testePort({ hote, port }) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: hote, port, timeout: 1000 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Résout un binaire sur le PATH (ou via une variable d'env de surcharge). */
function binaireDisponible(nom, envVar) {
  const cible = process.env[envVar] ?? nom;
  try {
    execFileSync(cible, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const resultats = await Promise.all(
  SERVICES.map(async (s) => ({ ...s, ok: await testePort(s) })),
);

console.log("\nÉtat des services (docker compose up -d) :");
for (const r of resultats) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.nom} (localhost:${r.port})`);
}

const manquants = resultats.filter((r) => !r.ok);
if (manquants.length > 0) {
  console.log(
    `\n⚠️  ${manquants.length} service(s) injoignable(s). Lancer : docker compose up -d`,
  );
}

console.log("\nPrérequis binaires hors Docker (npm run dev / npm run worker) :");
console.log(
  `  ${binaireDisponible("ffmpeg", "FFMPEG_PATH") ? "✓" : "✗"} ffmpeg`,
);
console.log(
  `  ${binaireDisponible("ffprobe", "FFPROBE_PATH") ? "✓" : "✗"} ffprobe`,
);
console.log(
  "\nDémarrer l'application : npm run dev  —  et le worker : npm run worker\n",
);
