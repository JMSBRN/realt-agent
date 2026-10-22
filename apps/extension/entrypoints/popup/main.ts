import { browser } from "wxt/browser";
import { createSupabase } from "@/lib/supabase";

const sb = createSupabase(false);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>("login");
const email = $<HTMLInputElement>("email");
const code = $<HTMLInputElement>("code");
const submit = $<HTMLButtonElement>("submit");
const error = $("error");

async function render() {
  const {
    data: { session },
  } = await sb.auth.getSession();
  form.hidden = !!session;
  $("account").hidden = !session;
  if (!session) return;
  $("who").textContent = `Вы вошли как ${session.user.email}`;
  const status = (await browser.runtime.sendMessage({ type: "status" })) as { subscribed: boolean };
  $("state").textContent = status.subscribed ? "🟢 Готов принимать задачи" : "🟡 Подключаюсь…";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  const res = code.hidden
    ? await sb.auth.signInWithOtp({ email: email.value, options: { shouldCreateUser: false } })
    : await sb.auth.verifyOtp({ email: email.value, token: code.value.trim(), type: "email" });
  submit.disabled = false;
  if (res.error) {
    error.textContent = res.error.message;
    return;
  }
  if (code.hidden) {
    code.hidden = false;
    email.disabled = true;
    submit.textContent = "Войти";
    code.focus();
    return;
  }
  await browser.runtime.sendMessage({ type: "auth-changed" });
  await render();
});

$("logout").addEventListener("click", async () => {
  await sb.auth.signOut({ scope: "local" });
  await browser.runtime.sendMessage({ type: "auth-changed" });
  await render();
});

render();
