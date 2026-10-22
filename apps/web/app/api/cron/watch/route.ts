import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueTask, isExtensionOnline } from "@/lib/search";

/** Vercel Cron (см. vercel.json): ставит задачи по подпискам «следить за новыми». */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();

  // Задачи, зависшие больше 30 минут (браузер закрыли посреди поиска), считаем проваленными
  await db
    .from("tasks")
    .update({ status: "failed", error: "timeout", finished_at: new Date().toISOString() })
    .in("status", ["queued", "running"])
    .lt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

  const { data: searches } = await db.from("searches").select("id, user_id, params").eq("watch", true);

  let queued = 0;
  for (const s of searches ?? []) {
    if (!(await isExtensionOnline(db, s.user_id))) continue;
    // не плодим задачи, если предыдущая ещё не выполнена
    const { count } = await db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("search_id", s.id)
      .in("status", ["queued", "running"]);
    if (count) continue;
    await enqueueTask(db, s.user_id, s.id, s.params, true);
    queued++;
  }
  return NextResponse.json({ queued });
}
