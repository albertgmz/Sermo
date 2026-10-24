import { ONLINE_TYPES, onlineList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import {
  OnlineRegion,
  type OnlineType,
} from "@/app/[locale]/(main)/online/online-list";
import { onlinePage } from "@/app/[locale]/(main)/online/online-page";
import { PageSwitch } from "@/components/forum/page-switch";
import type { Query } from "@/components/forum/places";
import { TabLinks } from "@/components/forum/tab-links";
import type { read } from "@/lib/sermo/client";

// The parameter of the address the filter tabs change in place.
export const ONLINE_SWITCH_PARAMS = ["type"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// The address of a filter, as XenForo's: `/online?type=guest` (its pages add `&page=2`).
const onlineHref = (type: OnlineType) =>
  type === "all" ? "/online" : `/online?type=${type}`;

// The filter tabs and the list of the filter and page the address names: what the page draws, and
// what a filter pressed brings in place (`onlineSection`). The list's pages turn in place inside it
// (`PageSwitch`). Read before it is returned, so that a refusal is the caller's to answer.
export async function OnlineSection({
  query,
  reader,
}: {
  query: Query;
  reader: typeof read;
}) {
  const raw = first(query.type);
  const type: OnlineType = ONLINE_TYPES.find((value) => value === raw) ?? "all";
  const asked = Number(first(query.page));
  const page =
    Number.isSafeInteger(asked) && asked >= 1 && asked <= 10_000 ? asked : 1;
  const [t, answer] = await Promise.all([
    getTranslations("members.online"),
    reader(onlineList, { type, page }),
  ]);
  return (
    <>
      <TabLinks
        label={t("aria.filter")}
        active={type}
        tabs={ONLINE_TYPES.map((value) => ({
          value,
          label: t(`tabs.${value}`),
          href: onlineHref(value),
        }))}
      />
      <div data-switch-panel="">
        <PageSwitch
          page={page}
          stamp={Date.now()}
          load={onlinePage.bind(null, type)}
        >
          <OnlineRegion type={type} answer={answer} />
        </PageSwitch>
      </div>
    </>
  );
}
