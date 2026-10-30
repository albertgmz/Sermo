"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { THEME_KEY } from "@/components/layout/theme";
import { buttonVariants } from "@/components/ui/button";
import { localeCookieValue } from "@/i18n/locale-cookie";
import { type ErrorLook, errorLook } from "@/lib/error-look";
import { cn } from "@/lib/utils";
import enLayout from "../../messages/en/layout.json";
import esLayout from "../../messages/es/layout.json";
import "./globals.css";

// Shown when the root layout itself fails, so it stands without the layout's providers, fonts and
// shell: it has its own document and reads its text straight from the messages. It sits outside
// the language segment, so it has no locale to follow: it draws Spanish and light, then, once in
// the browser, the language and theme the visitor chose (see `errorLook`).
const TEXT = { en: enLayout.globalError, es: esLayout.globalError };

function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

export default function GlobalError({ retry }: { retry: () => void }) {
  const [look, setLook] = useState<ErrorLook>({ language: "es", dark: false });
  useEffect(() => {
    setLook(
      errorLook(
        localeCookieValue(document.cookie),
        storedTheme(),
        matchMedia("(prefers-color-scheme: dark)").matches,
      ),
    );
  }, []);
  const t = TEXT[look.language];
  return (
    <html
      lang={look.language}
      data-theme={look.dark ? "dark" : "light"}
      className={cn("h-full antialiased", look.dark && "dark")}
    >
      <body className="flex min-h-full flex-col items-center justify-center bg-background p-4 text-foreground">
        <main className="flex w-full max-w-md flex-col items-center rounded-lg border bg-card px-4 py-10 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <TriangleAlert className="size-5" />
          </div>
          <h1 className="text-sm font-semibold">{t.title}</h1>
          <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
            {t.description}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className={cn(buttonVariants(), "mt-4 h-10 px-4")}
          >
            <RefreshCw />
            {t.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
