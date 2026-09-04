/**
 * Logique de protection des routes — ST 4.2 « Connexion / déconnexion »,
 * découpage en tâches point 3 : « Middleware de protection des routes
 * (import, sauvegarde, historique) ».
 *
 * Module **pur** (aucune dépendance, aucun `node:crypto`) : il est importé par
 * `src/middleware.ts` qui s'exécute sur le runtime Edge de Next. La
 * vérification cryptographique du jeton se fait ailleurs
 * (`readSessionFromCookieStore` dans `lib/session.ts`, côté Node) — cf. tête
 * de `src/middleware.ts` pour ce partage des responsabilités.
 */

/** Chemin de la page de connexion (vers laquelle on redirige un visiteur non connecté). */
export const LOGIN_PATH = "/connexion";

/** Destination par défaut après connexion quand aucune (ou une mauvaise) cible n'est fournie. */
export const DEFAULT_POST_LOGIN_PATH = "/mon-espace";

/**
 * Préfixes de chemins réservés aux comptes.
 *
 * Correspondance avec la story (« import, sauvegarde, historique ») :
 *  - `/mon-espace`  → sauvegarde privée + historique des doublages (ST 6.1 / 6.2) ;
 *  - `/import`      → import de vidéos personnelles (ST 5.1).
 *
 * Les endpoints publics existants (`POST /api/doublages` — doubler /
 * télécharger / partager **sans compte**, cf. cahier des charges §3-4) ne sont
 * volontairement **pas** listés ici.
 *
 * `/admin/moderation` (ST 7.2) : le middleware ne contrôle ici que la
 * **présence** du cookie ; le contrôle de **rôle** (`MODERATEUR`) est fait côté
 * serveur (`exigerModerateur`, page + endpoints). `/admin/scripts` (ST 1.3)
 * reste non listé (outil de contenu non protégé à ce stade).
 */
const PROTECTED_PREFIXES = ["/mon-espace", "/import", "/admin/moderation"] as const;

/**
 * `true` si `pathname` (partie chemin d'une URL, sans query) exige une
 * session. Un préfixe protège le chemin exact et tout ce qui est dessous
 * (`/mon-espace` et `/mon-espace/historique`), mais pas un faux ami
 * (`/mon-espace-public`).
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Valide un paramètre `next` (cible de redirection post-connexion) reçu de
 * l'extérieur.
 *
 * N'accepte qu'un **chemin interne** : commence par un seul `/`, pas de `//`
 * ni de `/\` (qui seraient interprétés comme une URL protocol-relative par
 * les navigateurs → redirection ouverte vers un domaine tiers). Toute autre
 * valeur retombe sur `DEFAULT_POST_LOGIN_PATH`.
 */
export function resolveSafeNext(
  next: string | null | undefined,
  fallback: string = DEFAULT_POST_LOGIN_PATH
): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/**
 * Construit le chemin de redirection vers la page de connexion en conservant
 * la cible d'origine dans `?next=` (le formulaire de connexion la relira via
 * `resolveSafeNext` pour renvoyer l'utilisateur au bon endroit).
 *
 * @param target chemin demandé (idéalement `pathname + search`)
 */
export function buildLoginRedirectPath(target: string): string {
  const safeTarget = resolveSafeNext(target, DEFAULT_POST_LOGIN_PATH);
  return `${LOGIN_PATH}?next=${encodeURIComponent(safeTarget)}`;
}
