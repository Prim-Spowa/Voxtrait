/**
 * Interprétation de la sortie de progression `ffmpeg -progress pipe:1` — ST 9.3,
 * utilisée par `videoCompressor.ts` et `doublageProcessor.ts` pour alimenter le
 * `onProgress` de `VideoCompressor`/`DoublageProcessor` (cf. `lib/import.ts`,
 * `lib/doublage.ts`) avec une progression réelle plutôt que des paliers fixes.
 *
 * Fonctions pures, testées sans lancer `ffmpeg` (`ffmpegProgress.test.ts`).
 */

/**
 * `ffmpeg -progress pipe:1` émet un flux de lignes `clé=valeur`, terminé par
 * `progress=continue` ou `progress=end` à chaque « trame » de progression. On
 * ne s'intéresse qu'à `out_time_ms` (position de sortie déjà encodée, en
 * microsecondes malgré son nom — comportement documenté de FFmpeg) pour
 * calculer une fraction `position / duréeTotale`.
 */
export function parseFfmpegProgressLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("=")) return null;
  const idx = trimmed.indexOf("=");
  return { key: trimmed.slice(0, idx).trim(), value: trimmed.slice(idx + 1).trim() };
}

/**
 * Construit un accumulateur de progression : à appeler pour chaque ligne de
 * `stdout` d'un `ffmpeg -progress pipe:1 -nostats`. Rappelle `onProgress` (borné
 * à `[0.05, 0.95]`, cohérent avec `runImportJob`/`runDoublageJob`) à chaque
 * trame `out_time_ms` reçue, en proportion de `totalDurationSeconds`.
 *
 * `totalDurationSeconds` peut être approximatif (ex. durée sondée à l'import,
 * durée déclarée de l'enregistrement voix) : la progression est indicative,
 * l'état terminal (`pret`/`echec`) ne dépend que du code de sortie du process.
 */
export function createFfmpegProgressTracker(
  totalDurationSeconds: number,
  onProgress?: (progress: number) => void
): (line: string) => void {
  const total = Number.isFinite(totalDurationSeconds) && totalDurationSeconds > 0
    ? totalDurationSeconds
    : null;

  return (line: string) => {
    if (!onProgress || !total) return;
    const parsed = parseFfmpegProgressLine(line);
    if (!parsed || parsed.key !== "out_time_ms") return;
    const outTimeMicroseconds = Number(parsed.value);
    if (!Number.isFinite(outTimeMicroseconds) || outTimeMicroseconds < 0) return;
    const fraction = outTimeMicroseconds / 1_000_000 / total;
    onProgress(Math.min(0.95, Math.max(0.05, fraction)));
  };
}
