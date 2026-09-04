import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exigerModerateur, NonAuthentifieError } from "@/lib/moderationAuth";
import { RoleInsuffisantError } from "@/lib/authz";
import { chargerJournalModeration } from "@/lib/moderation";
import {
  FileModerationQueryError,
  parseFileModerationQuery,
} from "@/lib/moderationClient";
import { getModerationStores } from "@/lib/mocks/moderation.mock";

/**
 * `GET /api/admin/moderation/journal` — journal des décisions de modération
 * (ST 7.2, tâche 4 : « Journalisation des décisions de modération
 * (traçabilité) »).
 *
 * **Réservé aux modérateurs** (même garde que `/api/admin/moderation`). Renvoie
 * les décisions les plus récentes d'abord, paginées. Query : `page`,
 * `pageSize` (défaut 20, max 100) — `statut` / `tri` de `parseFileModerationQuery`
 * sont ignorés ici. `200 { items, pagination }` ; `400` (query invalide),
 * `401` / `403`.
 */

const noStore = { "Cache-Control": "no-store" } as const;

export async function GET(request: NextRequest) {
  try {
    await exigerModerateur(cookies());
  } catch (err) {
    if (err instanceof NonAuthentifieError) {
      return NextResponse.json({ error: err.message }, { status: 401, headers: noStore });
    }
    if (err instanceof RoleInsuffisantError) {
      return NextResponse.json({ error: err.message }, { status: 403, headers: noStore });
    }
    throw err;
  }

  let query;
  try {
    query = parseFileModerationQuery(request.nextUrl.searchParams);
  } catch (err) {
    if (err instanceof FileModerationQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: noStore });
    }
    throw err;
  }

  const { decisions } = getModerationStores();
  const journal = await chargerJournalModeration(decisions, {
    page: query.page,
    pageSize: query.pageSize,
  });
  return NextResponse.json(journal, { status: 200, headers: noStore });
}
