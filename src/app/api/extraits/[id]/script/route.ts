import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDataSource } from "@/lib/config";
import { mockScriptLigneDelegate } from "@/lib/mocks/script.mock";
import {
  InvalidScriptLigneError,
  createScriptLignes,
  listScriptLignes,
  parseScriptLignesPayload,
} from "@/lib/script";

/**
 * GET /api/extraits/:id/script — ST 1.3 "Synchronisation script/dialogue".
 *
 * Retourne les lignes de script d'un extrait, triées par ordre d'apparition
 * (`timestampDebut` croissant). Un extrait sans script retourne un tableau
 * vide avec un statut 200 (pas une erreur) — cf. US 1.3, second critère
 * d'acceptation : « étant donné une vidéo sans script disponible [...] un
 * message m'indique l'absence de script (pas d'erreur bloquante) ». Ce
 * message est géré côté composant de consultation (`ScriptSynchronise`), pas
 * côté API : le endpoint reste un simple contrat de données.
 *
 * Source de données : Prisma/Postgres par défaut, ou jeu de données mocké en
 * mémoire si `DATA_SOURCE=mock` (cf. `src/lib/config.ts` et
 * `src/lib/mocks/script.mock.ts`) — même bascule que `GET /api/extraits`
 * (ST 1.1).
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const extraitId = params.id?.trim();
  if (!extraitId) {
    return NextResponse.json({ error: "Identifiant d'extrait manquant." }, { status: 400 });
  }

  const delegate = getDataSource() === "mock" ? mockScriptLigneDelegate : prisma.scriptLigne;
  const lignes = await listScriptLignes(delegate, extraitId);

  return NextResponse.json(
    { extraitId, lignes },
    {
      headers: {
        // Script d'un extrait déjà publié : lu fréquemment, peu volatile une
        // fois importé — même politique de cache que `GET /api/extraits`.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    }
  );
}

/**
 * POST /api/extraits/:id/script — outil interne de saisie/import des lignes
 * de script (ST 1.3, découpage en tâches, point 4).
 *
 * Corps attendu : `{ "lignes": [{ "texte": string, "timestampDebut": number,
 * "timestampFin": number }, ...] }`. Import atomique côté validation : si une
 * ligne du lot est invalide, la requête est rejetée en bloc (400) et rien
 * n'est inséré — cf. `parseScriptLignesPayload`.
 *
 * ⚠️ Aucun contrôle d'accès : aucun système d'authentification/rôles
 * n'existe encore dans le projet (ST 4.x, non développé à ce stade). Ce
 * endpoint est donc, en l'état, ouvert à quiconque en connaît l'URL —
 * inacceptable en production. Signalé explicitement ici et dans les notes de
 * dev de ST 1.3 comme point bloquant à lever avant mise en ligne (cf.
 * `AdminScriptEditorClient`, qui affiche le même avertissement côté UI).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const extraitId = params.id?.trim();
  if (!extraitId) {
    return NextResponse.json({ error: "Identifiant d'extrait manquant." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  let lignes;
  try {
    lignes = parseScriptLignesPayload(body);
  } catch (error) {
    if (error instanceof InvalidScriptLigneError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const delegate = getDataSource() === "mock" ? mockScriptLigneDelegate : prisma.scriptLigne;
  const inserted = await createScriptLignes(delegate, extraitId, lignes);

  return NextResponse.json({ extraitId, inserted }, { status: 201 });
}
