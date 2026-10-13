"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { createTranslator } from "use-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import layout from "../../messages/en/layout.json";
import "./globals.css";

// Shown when the root layout itself fails, so it stands without the layout's providers, fonts and
// shell: it has its own document and reads its text straight from the messages.
const t = createTranslator({
  locale: "en",
  messages: { layout },
  namespace: "layout.globalError",
});

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center bg-background p-4 text-foreground">
        <main className="flex w-full max-w-md flex-col items-center rounded-lg border bg-card px-4 py-10 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <TriangleAlert className="size-5" />
          </div>
          <h1 className="text-sm font-semibold">{t("title")}</h1>
          <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
            {t("description")}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className={cn(buttonVariants(), "mt-4 h-10 px-4")}
          >
            <RefreshCw />
            {t("retry")}
          </button>
        </main>
      </body>
    </html>
  );
}
