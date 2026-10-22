import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Realt Agent",
  description: "Поиск квартир на realt.by из Telegram через ваш браузер",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
