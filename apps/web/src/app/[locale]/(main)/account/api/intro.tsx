import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { Section } from "@/components/staff/rows";
import { publicUrl } from "@/lib/sermo/config";

const code = (chunks: React.ReactNode) => (
  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]">
    {chunks}
  </code>
);

// The address agents connect to, as the browser sees the site: read at request time, so the
// prerendered shell shows the path alone.
async function McpAddress() {
  await connection();
  return new URL("/mcp", publicUrl()).toString();
}

// What a key is for and where to read about the API.
export function ApiIntro() {
  const t = useTranslations("account.apiKeys.intro");
  return (
    <Section heading={t("heading")}>
      <div className="space-y-2 p-4 text-sm text-pretty">
        <p>{t("lead")}</p>
        <p>
          {t.rich("rest", {
            link: (chunks) => (
              <Link
                href="/developer"
                className="font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
        <p>
          {t.rich("mcp", {
            code,
            address: (chunks) =>
              code(
                <Suspense fallback={chunks}>
                  <McpAddress />
                </Suspense>,
              ),
          })}
        </p>
      </div>
    </Section>
  );
}

// Who holds a key holds the account: said before the key itself, on every visit.
export function KeyWarning() {
  const t = useTranslations("account.apiKeys.warning");
  return (
    <section
      aria-labelledby="api-key-warning"
      className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-destructive"
      />
      <div className="min-w-0 space-y-1">
        <h2 id="api-key-warning" className="text-sm font-semibold">
          {t("heading")}
        </h2>
        <p className="text-sm text-pretty">{t("body")}</p>
      </div>
    </section>
  );
}
