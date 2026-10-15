import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { acceptTerms } from "@/app/[locale]/(main)/actions";
import { ActionForm } from "@/components/forum/action-form";
import { Container } from "@/components/layout/container";
import { getViewer } from "@/lib/sermo/session";

export type PendingPage = { kind: "terms" | "rules"; version: number };

// The prompt for a member who has not accepted the current terms or rules: what is pending, a link
// to each page and one button. Reading goes on; posting, reacting and messaging wait for the
// answer. Drawn under the header like the site notices. `auth.me` already says what is pending,
// so it costs no request.
export async function AcceptancePrompt() {
  const { user } = await getViewer();
  if (!user || user.pendingAcceptance.length === 0) return null;
  return <AcceptanceStrip pending={user.pendingAcceptance} />;
}

export async function AcceptanceStrip({ pending }: { pending: PendingPage[] }) {
  const t = await getTranslations("layout.acceptancePrompt");
  return (
    <section aria-label={t("label")} className="border-b bg-muted">
      <Container>
        <div className="space-y-2 py-3">
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-sm">{t("body")}</p>
          <ul className="flex flex-wrap gap-x-4 text-sm">
            {pending.map((item) => (
              <li key={item.kind}>
                <Link
                  href={`/${item.kind}`}
                  className="inline-flex min-h-10 items-center font-medium text-primary-ink underline-offset-4 hover:underline md:min-h-8"
                >
                  {t(item.kind)}
                </Link>
              </li>
            ))}
          </ul>
          <ActionForm
            action={acceptTerms}
            submit={t("accept")}
            variant="default"
          >
            {pending.map((item) => (
              <input
                key={item.kind}
                type="hidden"
                name="accept"
                value={`${item.kind}:${item.version}`}
              />
            ))}
          </ActionForm>
        </div>
      </Container>
    </section>
  );
}
