import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ForumList,
  forumListChoice,
  withQuery,
} from "@/app/[locale]/(main)/forums/forum-list";
import { WebSiteJsonLd } from "@/components/forum/json-ld";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import {
  WidgetArea,
  widgetAreas,
  widgetAside,
  widgetLead,
} from "@/components/widgets/widget-area";
import { forumListAddress, homeMetadata } from "@/lib/home-seo";
import { publicUrl } from "@/lib/sermo/config";
import { getViewer } from "@/lib/sermo/session";
import { publicHead } from "@/lib/sermo/share";
import { getSite } from "@/lib/sermo/site";
import { getWidgets } from "@/lib/sermo/widgets";
import { cn } from "@/lib/utils";

// The home page is the forum list, under the site's own name. An address with a section, a
// statistics tab or a notice is a copy of it.
export async function generateMetadata({
  searchParams,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const [params, site, t] = await Promise.all([
    searchParams,
    getSite(),
    getTranslations("forums.forums"),
  ]);
  const head = homeMetadata({
    address: forumListAddress(params),
    origin: publicUrl(),
    title: site.name,
    description: site.description || t("metaDescription", { site: site.name }),
  });
  // The layout's template would add the site's name a second time.
  return publicHead({ ...head, title: { absolute: site.name } }, {});
}

async function GuestHero() {
  const t = await getTranslations("forums.forums");
  return (
    <PageHero title={t("heading")} subtitle={t("description")}>
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
      >
        {t("login")}
      </Link>
      <Link href="/register" className={cn(buttonVariants(), "h-10 px-4")}>
        {t("register")}
      </Link>
    </PageHero>
  );
}

// The forum list with the widgets of its positions: the lead above both columns, the statistics
// above the categories by default, and the sidebar.
export default async function HomePage(props: PageProps<"/[locale]">) {
  const [params, { user }, widgets, t] = await Promise.all([
    props.searchParams,
    getViewer(),
    getWidgets("home"),
    getTranslations("forums.forums"),
  ]);
  const { section } = forumListChoice(params);
  const areas = widgetAreas("home", widgets);
  const context = {
    params,
    widgets,
    href: (query: [string, string][]) => withQuery("/", section, query),
  };

  return (
    <>
      {!user && <GuestHero />}
      <PageLayout
        className={user ? undefined : "pt-2"}
        mainClassName="space-y-(--page-gap)"
        {...widgetLead(areas.lead, context)}
        {...widgetAside(areas.aside, context)}
      >
        {user && <h1 className="sr-only">{t("metaTitle")}</h1>}
        {/* The site's structured data belongs to its home address, not to a copy of it. */}
        {forumListAddress(params).index && <WebSiteJsonLd />}
        <HomeNotice notice={params.notice} />
        <WidgetArea widgets={areas.above} context={context} />
        <ForumList params={params} />
        <WidgetArea widgets={areas.below} context={context} />
      </PageLayout>
    </>
  );
}

// The lines a visitor is sent here with: a member whose account was just deleted (the action), and
// one the backend could not sign out (the sign-out route), with the tone of each.
const HOME_NOTICES = {
  accountDeleted: "text-success",
  signOutFailed: "text-destructive",
} as const;

async function HomeNotice({
  notice,
}: {
  notice: string | string[] | undefined;
}) {
  const t = await getTranslations("home.page");
  if (typeof notice !== "string" || !Object.hasOwn(HOME_NOTICES, notice))
    return null;
  const key = notice as keyof typeof HOME_NOTICES;
  return (
    <output
      className={cn(
        "block rounded-lg border bg-card p-4 text-sm",
        HOME_NOTICES[key],
      )}
    >
      {t(key)}
    </output>
  );
}
