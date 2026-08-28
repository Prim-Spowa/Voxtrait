/**
 * Logique client-safe du partage d'un doublage sur les réseaux sociaux —
 * ST 3.2 « Partage sur réseaux sociaux » (US 3.2 : partager mon doublage
 * directement sur les réseaux sociaux).
 *
 * Séparée de `lib/doublageShare.ts` (génération serveur des métadonnées Open
 * Graph, résolution du job) pour pouvoir être importée depuis un composant
 * `"use client"` (`DoublageShareButtons`) sans faire entrer de code serveur
 * dans le bundle navigateur — même séparation que `doublageClient.ts` vs
 * `doublage.ts` (ST 3.1) ou `scriptClient.ts` vs `script.ts` (ST 1.3).
 *
 * Contient : la construction du lien public d'un doublage, la détection de la
 * Web Share API et de son fallback, et le registre des « liens d'intent » par
 * réseau (découpage en tâches ST 3.2, point 2 : « Web Share API + fallback
 * boutons de partage par réseau »).
 */

/**
 * Visibilité d'un doublage — dupliquée ici (et non importée de `doublage.ts`)
 * pour rester client-safe. `privee` : accessible uniquement via le lien de
 * téléchargement signé (ST 3.1) ; `lien_public` : une page publique
 * `/doublage/:id` existe et peut être partagée. Distinct de la *sauvegarde
 * privée* liée au compte (ST 6.1) — cf. points d'attention ST 3.2.
 */
export type DoublageVisibilite = "privee" | "lien_public";

/** Préfixe de route de la page publique de partage. */
export const DOUBLAGE_PUBLIC_PATH_PREFIX = "/doublage";

/**
 * Chemin (relatif) de la page publique d'un doublage. `encodeURIComponent`
 * sur l'id : les ids en mémoire sont des UUID, mais un id issu d'un autre
 * store pourrait contenir des caractères à échapper.
 */
export function buildDoublagePublicPath(id: string): string {
  return `${DOUBLAGE_PUBLIC_PATH_PREFIX}/${encodeURIComponent(id.trim())}`;
}

/**
 * URL absolue de la page publique d'un doublage, à partir d'une origine
 * (`https://exemple.tld`, sans slash final requis) et de l'id du job.
 *
 * Utilisée côté serveur pour renseigner `og:url` / le lien canonique, et côté
 * client pour l'aperçu « copier le lien ». Retourne le chemin relatif seul si
 * `origin` est vide (dev/test sans origine résolue).
 */
export function resolveDoublageShareUrl(origin: string | null | undefined, id: string): string {
  const path = buildDoublagePublicPath(id);
  const trimmed = (origin ?? "").trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}${path}` : path;
}

// --- Texte de partage --------------------------------------------------

/**
 * Phrase d'accroche associée au partage (corps du tweet, message WhatsApp,
 * objet d'e-mail…). Vouvoiement, pas d'emoji (règles de contenu du design
 * system). Retombe sur une formule générique si le titre est vide.
 */
export function buildShareText(extraitTitre: string | null | undefined): string {
  const titre = (extraitTitre ?? "").trim();
  return titre
    ? `J'ai redoublé « ${titre} » sur Voxtrait. À écouter :`
    : `J'ai redoublé un extrait sur Voxtrait. À écouter :`;
}

// --- Web Share API ----------------------------------------------------

/** Sous-ensemble de `navigator` utilisé ici — permet un mock simple en test. */
export interface WebShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
}

/**
 * Indique si la Web Share API native est utilisable (typiquement mobile :
 * iOS Safari, Android Chrome). Sur desktop la méthode est le plus souvent
 * absente — on bascule alors sur les liens d'intent par réseau.
 *
 * `canShare` est vérifié quand il existe : certains navigateurs exposent
 * `share` mais refusent un payload donné (ex. partage de fichiers non
 * supporté). Ici on ne partage qu'un lien + du texte, cas le plus permissif.
 */
export function canUseWebShare(
  nav: WebShareNavigator | undefined,
  payload?: ShareData
): boolean {
  if (!nav || typeof nav.share !== "function") return false;
  if (typeof nav.canShare === "function" && payload) {
    try {
      return nav.canShare(payload);
    } catch {
      return false;
    }
  }
  return true;
}

export interface WebSharePayloadInput {
  extraitTitre: string | null | undefined;
  shareUrl: string;
}

/** Construit le `ShareData` passé à `navigator.share`. */
export function buildWebSharePayload(input: WebSharePayloadInput): ShareData {
  const titre = (input.extraitTitre ?? "").trim();
  return {
    title: titre ? `${titre} — doublage Voxtrait` : "Doublage Voxtrait",
    text: buildShareText(input.extraitTitre),
    url: input.shareUrl,
  };
}

/**
 * `true` si l'erreur remontée par `navigator.share` correspond à une
 * *annulation* par l'utilisateur (feuille de partage fermée) plutôt qu'à un
 * échec réel — dans ce cas l'UI ne doit afficher aucun message d'erreur.
 */
export function isShareAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /abort|cancel/i.test(error.message))
  );
}

// --- Liens d'intent par réseau (fallback desktop) --------------------

export type ShareNetworkId = "x" | "facebook" | "whatsapp" | "telegram" | "reddit" | "email";

export interface ShareNetwork {
  id: ShareNetworkId;
  /** Libellé affiché sur le bouton. */
  label: string;
  /** Construit l'URL d'intent (lien `mailto:` pour l'e-mail). */
  buildUrl: (params: { shareUrl: string; text: string; title: string }) => string;
}

/**
 * Registre des réseaux proposés en fallback. Volontairement limité aux
 * plateformes exposant un endpoint de partage par simple URL (« sans
 * dépendance à un SDK tiers lourd par réseau », choix techniques ST 3.2).
 *
 * Ajouter un réseau = ajouter une entrée ici : le composant les rend en
 * boucle, aucun code spécifique par réseau ailleurs.
 */
export const SHARE_NETWORKS: readonly ShareNetwork[] = [
  {
    id: "x",
    label: "X",
    buildUrl: ({ shareUrl, text }) =>
      `https://twitter.com/intent/tweet?url=${enc(shareUrl)}&text=${enc(text)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    buildUrl: ({ shareUrl }) => `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}`,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    buildUrl: ({ shareUrl, text }) => `https://wa.me/?text=${enc(`${text} ${shareUrl}`)}`,
  },
  {
    id: "telegram",
    label: "Telegram",
    buildUrl: ({ shareUrl, text }) =>
      `https://t.me/share/url?url=${enc(shareUrl)}&text=${enc(text)}`,
  },
  {
    id: "reddit",
    label: "Reddit",
    buildUrl: ({ shareUrl, title }) =>
      `https://www.reddit.com/submit?url=${enc(shareUrl)}&title=${enc(title)}`,
  },
  {
    id: "email",
    label: "E-mail",
    buildUrl: ({ shareUrl, text, title }) =>
      `mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${shareUrl}`)}`,
  },
];

export interface ShareLink {
  id: ShareNetworkId;
  label: string;
  url: string;
}

/**
 * Résout la liste des liens de partage prêts à poser dans des `<a href>`,
 * pour un doublage donné. Le titre passé aux réseaux reprend celui du payload
 * Web Share (cohérence entre les deux chemins de partage).
 */
export function buildShareLinks(input: {
  shareUrl: string;
  extraitTitre: string | null | undefined;
}): ShareLink[] {
  const text = buildShareText(input.extraitTitre);
  const title = buildWebSharePayload({
    extraitTitre: input.extraitTitre,
    shareUrl: input.shareUrl,
  }).title as string;

  return SHARE_NETWORKS.map((network) => ({
    id: network.id,
    label: network.label,
    url: network.buildUrl({ shareUrl: input.shareUrl, text, title }),
  }));
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
