/**
 * Logique du composant `VideoPlayer` (ST 1.2 « Lecteur vidéo (extraits embed
 * et upload) »).
 *
 * Séparée du composant React — même pattern que `lib/extraits.ts` pour ST 1.1
 * — afin de rester testable sans monter de DOM : résolution du mode de
 * lecture, validation de la source, et horloge de secours utilisée en mode
 * embed (cf. plus bas).
 */

export type PlayerSource = "EMBED" | "UPLOAD";
export type PlayerMode = "native" | "embed";

/**
 * Le mode de lecture est entièrement déterminé par le type de source de
 * l'extrait (cf. ST 1.2, "Choix techniques" : un seul composant, deux modes).
 */
export function resolvePlayerMode(source: PlayerSource): PlayerMode {
  return source === "UPLOAD" ? "native" : "embed";
}

/**
 * Valide qu'une URL de source est exploitable avant de monter le lecteur.
 *
 * Retourne un message d'erreur utilisateur si la source est absente ou
 * syntaxiquement invalide, `null` si elle peut être tentée. Couvre le cas
 * « source indisponible » du DoD de ST 1.2 en amont du montage du lecteur ;
 * ne garantit pas que la ressource répond une fois chargée (cf. gestion des
 * erreurs runtime — `onError` — dans `VideoPlayer`).
 */
export function validatePlayerUrl(url: string | null | undefined): string | null {
  if (!url || !url.trim()) {
    return "Aucune source vidéo n'est disponible pour cet extrait.";
  }
  try {
    new URL(url);
    return null;
  } catch {
    return "L'URL de la source vidéo est invalide.";
  }
}

/**
 * Délai par défaut avant de considérer un embed comme bloqué/indisponible.
 *
 * Une iframe tierce dont le chargement échoue silencieusement (ex. en-tête
 * `X-Frame-Options` ou CSP du site source) ne déclenche pas toujours
 * d'évènement `error` exploitable côté navigateur. Ce délai sert de filet :
 * si ni `onLoad` ni `onError` ne se sont produits avant son expiration, on
 * traite l'embed comme en échec (cf. `VideoPlayer`, mode embed).
 */
export const DEFAULT_EMBED_LOAD_TIMEOUT_MS = 8000;

/** Cadence par défaut des ticks de l'horloge de secours (cf. `createFallbackClock`). */
export const DEFAULT_FALLBACK_CLOCK_INTERVAL_MS = 250;

export interface FallbackClockOptions {
  /** Appelé à chaque tick avec le temps écoulé (secondes) depuis le dernier `reset`. */
  onTick: (elapsedSeconds: number) => void;
  intervalMs?: number;
}

export interface FallbackClockHandle {
  start(): void;
  pause(): void;
  reset(): void;
  isRunning(): boolean;
}

/**
 * Horloge de secours pour le mode embed.
 *
 * Point d'attention de ST 1.2 : « les extraits embed n'exposent pas toujours
 * d'API de timing fiable — prévoir un fallback si `timeupdate` n'est pas
 * disponible. » Une iframe tierce générique ne notifie ni lecture, ni pause,
 * ni position de lecture au parent (pas d'API cross-origine standard). Cette
 * horloge fournit un temps approximatif, déclenché manuellement par la
 * personne qui regarde (cf. `VideoPlayer`, mode embed) : ce n'est pas un vrai
 * évènement `timeupdate` du lecteur tiers, mais une estimation jugée
 * suffisante pour la synchro du script (ST 1.3) en l'absence de mieux.
 *
 * ⚠️ Point à confirmer en revue (signalé aussi dans les notes de dev) : le
 * déclenchement manuel n'est pas spécifié par la story — c'est l'hypothèse la
 * plus simple compatible avec la contrainte technique décrite. Si certaines
 * plateformes embarquées exposent une API `postMessage` dédiée (YouTube
 * IFrame API, Vimeo Player API, ...), une intégration par plateforme pourrait
 * remplacer cette horloge — explicitement hors périmètre de ST 1.2 telle que
 * rédigée.
 */
export function createFallbackClock({
  onTick,
  intervalMs = DEFAULT_FALLBACK_CLOCK_INTERVAL_MS,
}: FallbackClockOptions): FallbackClockHandle {
  let timer: ReturnType<typeof setInterval> | null = null;
  let elapsedMs = 0;
  let lastTickAt: number | null = null;

  function tick() {
    const now = Date.now();
    if (lastTickAt !== null) {
      elapsedMs += now - lastTickAt;
    }
    lastTickAt = now;
    onTick(elapsedMs / 1000);
  }

  return {
    start() {
      if (timer !== null) return; // déjà démarrée : no-op plutôt que double-timer
      lastTickAt = Date.now();
      timer = setInterval(tick, intervalMs);
    },
    pause() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      lastTickAt = null;
    },
    reset() {
      elapsedMs = 0;
      lastTickAt = timer !== null ? Date.now() : null;
      onTick(0);
    },
    isRunning() {
      return timer !== null;
    },
  };
}
