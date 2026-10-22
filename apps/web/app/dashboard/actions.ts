"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** Одноразовая ссылка t.me/<bot>?start=<code> для привязки Telegram. */
export async function createTelegramLink() {
  const { user } = await requireUser();
  const code = randomBytes(16).toString("hex");
  const { error } = await createAdminClient().from("telegram_link_codes").insert({ code, user_id: user.id });
  if (error) throw error;
  redirect(`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${code}`);
}

export async function updateSettings(formData: FormData) {
  const { supabase, user } = await requireUser();
  const format = formData.get("result_format") === "links" ? "links" : "cards";
  const limit = Math.min(20, Math.max(1, Number(formData.get("results_limit")) || 5));
  await supabase.from("profiles").update({ result_format: format, results_limit: limit }).eq("id", user.id);
  revalidatePath("/dashboard");
}

export async function setWatch(searchId: string, watch: boolean) {
  const { supabase } = await requireUser();
  await supabase.from("searches").update({ watch }).eq("id", searchId);
  revalidatePath("/dashboard");
}

export async function signOut() {
  const { supabase } = await requireUser();
  await supabase.auth.signOut();
  redirect("/");
}
