import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HtmlContent } from "@/components/forum/html-content";
import { LoggedData } from "@/components/forum/logged-data";
import { PageLayout } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  type Category,
  type InventoryItem,
  itemsOf,
  OPTIONAL_CATEGORIES,
} from "@/lib/consent/inventory";
import { isCookielessMatomo } from "@/lib/consent/state";
import { getCookiePolicyText } from "@/lib/sermo/cookie-policy";
import { getSite } from "@/lib/sermo/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("cookies.policy");
  return { title: t("metaTitle") };
}

// The one place the policy's words and the inventory meet: every cookie, storage key and provider
// is drawn from `INVENTORY`, so the page cannot drift from what the code stores.
async function Item({ item }: { item: InventoryItem }) {
  const [t, policy] = await Promise.all([
    getTranslations(`cookies.items.${item.id}` as "cookies.items.session"),
    getTranslations("cookies.policy"),
  ]);
  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-semibold">{t("title")}</h3>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{policy("name")}</dt>
        <dd className="min-w-0 break-words">
          {item.names.length > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {item.names.map((name) => (
                <li key={name}>
                  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] break-all">
                    {name}
                  </code>
                </li>
              ))}
            </ul>
          ) : (
            policy("noNames")
          )}
        </dd>
        <dt className="text-muted-foreground">{policy("storage")}</dt>
        <dd>{policy(`storages.${item.storage}`)}</dd>
        <dt className="text-muted-foreground">{policy("purpose")}</dt>
        <dd>{t("purpose")}</dd>
        <dt className="text-muted-foreground">{policy("lifetime")}</dt>
        <dd>{t("lifetime")}</dd>
        <dt className="text-muted-foreground">{policy("provider")}</dt>
        <dd>{item.party === "first" ? policy("thisSite") : item.party}</dd>
      </dl>
    </div>
  );
}

// `cookieless`: the site's statistics run without cookies, so there is nothing to list or to
// consent to in this category.
async function Section({
  category,
  cookieless = false,
}: {
  category: Category;
  cookieless?: boolean;
}) {
  const [t, policy] = await Promise.all([
    getTranslations(`cookies.banner.categories.${category}`),
    getTranslations("cookies.policy"),
  ]);
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight">
        {category === "necessary" ? policy("necessaryHeading") : t("title")}
      </h2>
      <p className="mt-1 text-muted-foreground">{t("description")}</p>
      {category !== "necessary" && (
        <p className="mt-1 text-sm font-medium">
          {cookieless ? policy("cookielessNote") : policy("optionalNote")}
        </p>
      )}
      {!cookieless && (
        <div className="mt-3 grid gap-3">
          {itemsOf(category).map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function CookiePolicyPage() {
  const [t, site, written] = await Promise.all([
    getTranslations("cookies.policy"),
    getSite(),
    getCookiePolicyText(),
  ]);
  const cookieless = isCookielessMatomo(site.analytics, site.matomoCookieless);
  return (
    <PageLayout className="md:pt-8">
      <article className="max-w-prose">
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {written?.title ?? t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("version", { version: site.cookiePolicyVersion })}
        </p>
        {written ? (
          <HtmlContent className="mt-6">{written.bodyHtml}</HtmlContent>
        ) : (
          <p className="mt-6">{t("intro")}</p>
        )}
        <p className="mt-3">{t("yourChoice")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Button data-consent-settings="" className="h-10 md:h-8">
            {t("openSettings")}
          </Button>
          <Link
            href="/privacy"
            className="font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
          >
            {t("privacyLink")}
          </Link>
        </div>
        <Section category="necessary" />
        {OPTIONAL_CATEGORIES.map((category) => (
          <Section
            key={category}
            category={category}
            cookieless={cookieless && category === "analytics"}
          />
        ))}
        <LoggedData />
      </article>
    </PageLayout>
  );
}
