import { NextResponse, type NextRequest } from "next/server";
import { TaskResultSchema } from "@realt-agent/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverResults } from "@/lib/search";
import { sendMessage } from "@/lib/telegram";

/**
 * Расширение присылает сюда итог задачи.
 * Авторизация — access token пользователя Supabase в заголовке Authorization.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createAdminClient();
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = TaskResultSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const result = parsed.data;

  const { data: task } = await db
    .from("tasks")
    .select("id, user_id, search_id, payload, only_new, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (task.status === "done") return NextResponse.json({ ok: true }); // повтор

  await db
    .from("tasks")
    .update({
      status: result.status,
      error: result.status === "failed" ? result.error : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (result.status === "done") {
    await deliverResults(db, task, result.items);
  } else {
    const { data: profile } = await db.from("profiles").select("telegram_chat_id").eq("id", user.id).single();
    if (profile?.telegram_chat_id) {
      await sendMessage(
        profile.telegram_chat_id,
        result.status === "captcha"
          ? "⚠️ realt.by показал проверку «я не робот». Откройте Chrome, пройдите её и повторите запрос."
          : "⚠️ Поиск не удался. Попробуйте ещё раз чуть позже.",
      );
    }
  }
  return NextResponse.json({ ok: true });
}
