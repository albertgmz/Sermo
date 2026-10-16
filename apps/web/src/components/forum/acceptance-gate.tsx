import { pagesGet } from "@sermo/core/contracts";
import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { acceptTerms, logout } from "@/app/[locale]/(main)/actions";
import { ActionForm } from "@/components/forum/action-form";
import { HtmlContent } from "@/components/forum/html-content";
import { LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { call, forwardFromRequest } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";
import { sermoCookies } from "@/lib/sermo/transport";

export type PendingPage = { kind: "terms" | "rules"; version: number };

// What is pending for a viewer. A backend from before the field was added leaves it out: nothing
// is pending then, and the layout must not fail over it.
export const pendingOf = (
  user: { pendingAcceptance?: PendingPage[] } | null,
): PendingPage[] => user?.pendingAcceptance ?? [];

// What the request's member has still to accept. A visitor without a session cookie has nothing
// to accept, so the page does not wait for the guest's `auth.me`; a member's is the request's one
// read, which every call waits for anyway.
async function pendingOfRequest(): Promise<PendingPage[]> {
  if (!sermoCookies((await forwardFromRequest()).cookie)) return [];
  return pendingOf((await getViewer()).user);
}

// Drawn only with the gate: the forum's header, notices, footer and bottom bar are hidden, so
// neither the eye nor the keyboard reaches them. The layout draws them before it knows.
const HIDE_FORUM =
  "[data-forum-layout]>:not([data-forum-body]),[data-forum-body]>:not(main){display:none}";

// The page for a member who has not accepted the current terms or rules: the whole screen, in
// place of the page they asked for, which is not drawn at all. Accepting draws the same address
// again, now with its page.
export async function AcceptanceGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pending = await pendingOfRequest();
  if (pending.length === 0) return children;
  // A page that cannot be read now fails the request: the error screen offers to try again.
  const pages = await Promise.all(
    pending.map((item) => call(pagesGet, { slug: item.kind })),
  );
  return (
    <div
      data-acceptance-gate=""
      className="fixed inset-0 overflow-y-auto overscroll-contain bg-background"
    >
      <style>{HIDE_FORUM}</style>
      <AcceptanceScreen pending={pending} pages={pages} />
    </div>
  );
}

type GatePage = { slug: string; title: string; bodyHtml: string };

// The site's mark and name, the pending pages' text in a box that scrolls, and the two ways out:
// accept, or log out. At least as tall as the box it is put in, which scrolls when the screen is
// too short for it (a phone held sideways, zoomed text).
export async function AcceptanceScreen({
  pending,
  pages,
}: {
  pending: PendingPage[];
  pages: GatePage[];
}) {
  const [site, t] = await Promise.all([
    getSite(),
    getTranslations("layout.acceptanceGate"),
  ]);
  const [first] = pending;
  const which = pending.length === 1 && first ? first.kind : "both";
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-2 px-4 font-bold tracking-tight">
          {/* The name follows: the mark's picture is not read out as well. */}
          <span aria-hidden="true" className="flex">
            <LogoMark />
          </span>
          <span className="truncate">{site.name}</span>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-10 md:pb-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-balance">
            {t("title", { which })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("body", { site: site.name })}
          </p>
        </div>
        {/* As tall as the text, up to what leaves the title and the buttons in view; never so
          short that the text cannot be read in it. */}
        <section
          aria-label={t("label", { which })}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a box that scrolls takes the focus to be scrolled from the keyboard
          tabIndex={0}
          className="max-h-[max(10rem,calc(100dvh-20rem))] divide-y overflow-y-auto overscroll-contain rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {pages.map((page) => (
            <article key={page.slug} className="p-4 sm:p-6">
              <h2 className="text-lg font-semibold tracking-tight text-balance">
                {page.title}
              </h2>
              <HtmlContent className="mt-3">{page.bodyHtml}</HtmlContent>
            </article>
          ))}
        </section>
        {/* The one action the screen is for: the full width on a phone, log out under it. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <ActionForm
            action={acceptTerms}
            submit={t("accept")}
            variant="default"
            className="[&_button]:w-full sm:[&_button]:w-auto"
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
          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              className="h-10 w-full px-3 sm:w-auto"
            >
              <LogOut aria-hidden="true" />
              {t("logout")}
            </Button>
          </form>
        </div>
      </div>
      {/* While the cookie banner is up, room under the buttons as tall as the banner (as the
        rest of the site keeps, globals.css), so they can be scrolled clear of it. */}
      <div
        aria-hidden="true"
        className="hidden h-(--consent-space) shrink-0 [.show--consent_&]:block"
      />
    </div>
  );
}
