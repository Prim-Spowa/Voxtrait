import type { Prisma, ScriptLigne } from "@prisma/client";
import { validateScriptLigneInput, type ScriptLigneInput } from "@/lib/scriptClient";

/**
 * Logique métier serveur du endpoint `GET/POST /api/extraits/:id/script`
 * (ST 1.3 "Synchronisation script/dialogue").
 *
 * Même séparation logique/route que `lib/extraits.ts` (ST 1.1) et
 * `lib/videoPlayer.ts` (ST 1.2) : testable sans dépendre du runtime Next ni
 * d'une base réelle (delegate Prisma injecté, cf. `ScriptLigneDelegate`
 * ci-dessous). Importe `@prisma/client` : réservé au code serveur — la
 * logique réutilisable côté client (`use client`) vit dans
 * `lib/scriptClient.ts`.
 */

export class InvalidScriptLigneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScriptLigneError";
  }
}

/** Sous-ensemble du client Prisma utilisé ici — permet un mock simple en test. */
export type ScriptLigneDelegate = {
  findMany: (args: Prisma.ScriptLigneFindManyArgs) => Promise<ScriptLigne[]>;
  createMany: (args: Prisma.ScriptLigneCreateManyArgs) => Promise<{ count: number }>;
};

/**
 * Récupère les lignes de script d'un extrait, triées par ordre d'apparition
 * (`timestampDebut` croissant).
 *
 * Un tableau vide est un résultat normal (extrait sans script importé, ou
 * `extraitId` inconnu) — cf. US 1.3, second critère d'acceptation : « étant
 * donné une vidéo sans script disponible [...] un message m'indique
 * l'absence de script (pas d'erreur bloquante) ». Cette fonction ne
 * distingue pas "extrait inconnu" de "extrait connu sans script" : les deux
 * cas produisent la même réponse vide côté consultation publique, ce qui
 * suffit au critère d'acceptation. Voir notes de dev pour la limite de ce
 * choix côté outil admin.
 */
export async function listScriptLignes(
  delegate: Pick<ScriptLigneDelegate, "findMany">,
  extraitId: string
): Promise<ScriptLigne[]> {
  return delegate.findMany({
    where: { extraitId },
    orderBy: { timestampDebut: "asc" },
  });
}

/**
 * Parse et valide le corps de requête de `POST /api/extraits/:id/script`
 * (saisie/import de lignes, cf. ST 1.3, découpage en tâches, point 4).
 *
 * Attend `{ "lignes": ScriptLigneInput[] }` — un tableau plutôt qu'un objet
 * unique, pour couvrir aussi bien la saisie d'une ligne à la fois (tableau à
 * un élément, cf. formulaire de l'outil admin) que l'import en masse (coller
 * un script entier). Réutilise `validateScriptLigneInput` (règles partagées
 * avec la validation côté formulaire, cf. `lib/scriptClient.ts`).
 *
 * Lève une `InvalidScriptLigneError` au premier problème rencontré, avec le
 * numéro de ligne concerné (1-indexé, plus lisible pour l'utilisateur de
 * l'outil admin) — import atomique : un lot contenant une ligne invalide
 * n'insère rien plutôt que d'importer partiellement.
 */
export function parseScriptLignesPayload(body: unknown): ScriptLigneInput[] {
  if (
    !body ||
    typeof body !== "object" ||
    !("lignes" in body) ||
    !Array.isArray((body as { lignes: unknown }).lignes)
  ) {
    throw new InvalidScriptLigneError(
      'Le corps de la requête doit contenir un tableau "lignes".'
    );
  }

  const raw = (body as { lignes: unknown[] }).lignes;
  if (raw.length === 0) {
    throw new InvalidScriptLigneError('Le tableau "lignes" ne peut pas être vide.');
  }

  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new InvalidScriptLigneError(`Ligne ${i + 1} : format invalide.`);
    }
    const { texte, timestampDebut, timestampFin } = entry as Record<string, unknown>;
    const candidate: ScriptLigneInput = {
      texte: typeof texte === "string" ? texte : "",
      timestampDebut: typeof timestampDebut === "number" ? timestampDebut : NaN,
      timestampFin: typeof timestampFin === "number" ? timestampFin : NaN,
    };
    const error = validateScriptLigneInput(candidate);
    if (error) {
      throw new InvalidScriptLigneError(`Ligne ${i + 1} : ${error}`);
    }
    return candidate;
  });
}

/**
 * Insère un lot de lignes déjà validées pour un extrait donné.
 *
 * `delegate` est injecté (comme `listScriptLignes`) pour rester testable
 * sans base réelle. L'ordre de saisie n'a pas besoin d'être trié : c'est
 * `listScriptLignes` qui trie par `timestampDebut` à la lecture, pas cette
 * fonction à l'écriture.
 */
export async function createScriptLignes(
  delegate: Pick<ScriptLigneDelegate, "createMany">,
  extraitId: string,
  lignes: readonly ScriptLigneInput[]
): Promise<number> {
  const { count } = await delegate.createMany({
    data: lignes.map((ligne) => ({ ...ligne, extraitId })),
  });
  return count;
}
