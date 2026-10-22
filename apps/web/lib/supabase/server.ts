import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Клиент от имени вошедшего пользователя (RLS действует). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
          } catch {
            // вызов из Server Component: куки обновит middleware
          }
        },
      },
    },
  );
}
