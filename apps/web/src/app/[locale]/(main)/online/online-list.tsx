import type { ONLINE_TYPES, onlineList } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { OnlineRow } from "@/app/[locale]/(main)/online/online-row";
import { PageNav } from "@/components/forum/page-nav";

export type OnlineType = (typeof ONLINE_TYPES)[number];
type Answer = z.output<typeof onlineList.output>;

// The part of the current visitors that turns with its pages (`PageSwitch`): the pager above the
// list (from a wide screen up, as XenForo's), the visitors, the pager below.
export function OnlineRegion({
  type,
  answer,
}: {
  type: OnlineType;
  answer: Answer;
}) {
  const t = useTranslations("members.online");
  const pages = Math.max(1, Math.ceil(answer.total / answer.perPage));
  const pager = (className: string) => (
    <PageNav
      page={answer.page}
      pages={pages}
      path="/online"
      params={type === "all" ? {} : { type }}
      className={className}
    />
  );
  return (
    <>
      {pager("mb-3 max-sm:hidden")}
      <section className="overflow-hidden rounded-lg border bg-card">
        {answer.items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {answer.items.map((visitor, index) => (
              <OnlineRow
                key={visitor.card?.id ?? `${answer.page}-${index}`}
                visitor={visitor}
              />
            ))}
          </ol>
        )}
      </section>
      {pager("mt-3")}
    </>
  );
}
