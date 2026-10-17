import { LogIn } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import {
  AccountMenu,
  AccountMenuSkeleton,
} from "@/components/layout/account-menu";
import { AnalyticsTag } from "@/components/layout/analytics-tag";
import { ClientMessages } from "@/components/layout/client-messages";
import { Container } from "@/components/layout/container";
import { getAccent } from "@/components/layout/header-data";
import { LocaleSyncGate } from "@/components/layout/locale-sync-gate";
import { Logo } from "@/components/layout/logo";
import { SessionNotice } from "@/components/layout/session-notice";
import { ViewerAccent } from "@/components/layout/site-accent";
import { buttonVariants } from "@/components/ui/button";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

// Messages and Alerts in the top bar from `sm`, as in the staff panel: on the narrowest phones
// the bar needs the room.
const INBOX = "hidden sm:inline-flex";

// The developer page's own frame, apart from the forum like the staff panel: a slim top bar (the
// way back to the site, the section's name, the member's own menu or a guest's sign-in) and the
// page under it, filling the window. No forum navigation, phone bar or footer.
export default function DeveloperLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const t = useTranslations("developer.frame");
  const header = useTranslations("layout.siteHeader");
  return (
    <ClientMessages
      namespaces={[
        "forum.memberCard",
        "forum.memberCardTrigger",
        "layout.headerPanel",
        "layout.headerPanels",
        "layout.lazyPopup",
        "layout.themeControl",
        "layout.userMenu",
        "lib.errors",
        "lite.menuItem",
        "lite.status",
        "members.wallButtons",
        "skeletons.skeletons",
        "ui.sheet",
      ]}
    >
      <div className="flex min-h-dvh flex-1 flex-col [--container-width:none]">
        <Suspense>
          <DeveloperAccent />
        </Suspense>
        <Suspense>
          <SessionNotice />
        </Suspense>
        <Suspense>
          <LocaleSyncGate />
        </Suspense>
        <Suspense>
          <AnalyticsTag />
        </Suspense>
        <header className="sticky top-0 z-30 border-b bg-background">
          <Container className="flex h-14 items-center gap-1 sm:gap-3">
            <Logo markOnly className="w-10 justify-center sm:hidden" />
            <Logo className="hidden sm:inline-flex" />
            <p className="min-w-0 flex-1 truncate border-l pl-3 text-sm font-semibold">
              {t("label")}
            </p>
            <Suspense
              fallback={
                <LoadingRegion label={header("loadingAccount")}>
                  <AccountMenuSkeleton inboxClassName={INBOX} />
                </LoadingRegion>
              }
            >
              <Account />
            </Suspense>
          </Container>
        </header>
        <main className="flex-1">
          <Container className="py-4 pb-8 md:py-8">{children}</Container>
        </main>
      </div>
    </ClientMessages>
  );
}

async function DeveloperAccent() {
  return <ViewerAccent accent={await getAccent()} />;
}

// A member's Messages, Alerts and account menu; a guest's way to sign in, back to this page.
async function Account() {
  const [viewer, t] = await Promise.all([
    getViewer(),
    getTranslations("layout.siteHeader"),
  ]);
  if (viewer.user) return <AccountMenu inboxClassName={INBOX} />;
  return (
    <Link
      href="/login?next=/developer"
      className={cn(buttonVariants({ variant: "outline" }), "h-10 px-3")}
    >
      <LogIn aria-hidden="true" />
      {t("login")}
    </Link>
  );
}
