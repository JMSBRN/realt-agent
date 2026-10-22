"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Вход по одноразовому коду из письма (тот же способ использует расширение). */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = sent
      ? await supabase.auth.verifyOtp({ email, token: code, type: "email" })
      : await supabase.auth.signInWithOtp({ email });
    setBusy(false);
    if (error) return setError(error.message);
    if (!sent) return setSent(true);
    router.replace("/dashboard");
    router.refresh();
  }

  const input =
    "w-full rounded-xl border border-zinc-300 bg-transparent px-4 py-3 outline-none focus:border-emerald-600 dark:border-zinc-700";

  return (
    <main className="mx-auto max-w-sm px-4 py-24">
      <h1 className="text-2xl font-bold">Вход</h1>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          className={input}
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          disabled={sent}
          onChange={(e) => setEmail(e.target.value)}
        />
        {sent && (
          <input
            className={input}
            inputMode="numeric"
            required
            placeholder="Код из письма"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-3 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {sent ? "Войти" : "Получить код"}
        </button>
      </form>
    </main>
  );
}
