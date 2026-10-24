import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { History } from "@/app/[locale]/(main)/credits/history";
import { Inventory } from "@/app/[locale]/(main)/credits/inventory";
import { Shop } from "@/app/[locale]/(main)/credits/shop";
import type { Query } from "@/components/forum/places";
import { TabLinks } from "@/components/forum/tab-links";
import { pagesParam } from "@/lib/list-pages";
import { getViewer } from "@/lib/sermo/session";

const TABS = ["shop", "inventory", "history"] as const;
const NOTICES = ["bought", "worn", "removed", "used"] as const;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

// The tabs and the open one as the address names them; also what a tab pressed brings in place
// (`creditsContent`).
export async function Content({ query }: { query: Query }) {
  const [t, { user }] = await Promise.all([
    getTranslations("credits.credits"),
    getViewer(),
  ]);
  const notice = NOTICES.find((entry) => entry === first(query.notice));
  const requested = TABS.find((entry) => entry === first(query.tab));
  const tab = user && requested ? requested : "shop";
  const labels = {
    shop: t("shopTab"),
    inventory: t("inventoryTab"),
    history: t("historyTab"),
  };
  return (
    <>
      {user ? (
        <TabLinks
          tabs={TABS.map((value) => ({
            value,
            label: labels[value],
            href: value === "shop" ? "/credits" : `/credits?tab=${value}`,
          }))}
          active={tab}
          label={t("aria.sections")}
        />
      ) : (
        <h2 className="border-b pb-2 text-lg font-semibold tracking-tight">
          {t("shopTab")}
        </h2>
      )}
      <div data-switch-panel="" className="space-y-4">
        {notice && (
          <output className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-pretty">
            <Check
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
            {t(`notices.${notice}`)}
          </output>
        )}
        {tab === "shop" && (
          <Shop
            category={first(query.category)}
            cursor={first(query.cursor) || undefined}
            pages={pagesParam(query.pages)}
            viewer={user && { id: user.id, username: user.username }}
          />
        )}
        {tab === "inventory" && user && (
          <Inventory
            viewer={{ id: user.id, username: user.username }}
            cursors={{
              active: first(query.active) || undefined,
              unused: first(query.unused) || undefined,
              threads: first(query.threads) || undefined,
            }}
          />
        )}
        {tab === "history" && user && (
          <History
            cursor={first(query.cursor) || undefined}
            pages={pagesParam(query.pages)}
          />
        )}
      </div>
    </>
  );
}
