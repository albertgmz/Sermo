"use server";

import {
  STATS_TABS,
  StatsTabPanel,
} from "@/app/[locale]/(main)/forums/forum-stats";

// The tabs and the threads of the statistics tab the address with `search` names, for a tab
// pressed (`TabSwitch`): `path` is the page the panel is on and `param` the parameter that keeps
// its tab. Each tab's link is that address with the tab set, as the page draws it (from the first
// page of any list on it).
export async function forumStatsTab(
  path: string,
  param: string,
  limit: number,
  search: string,
) {
  if (
    typeof path !== "string" ||
    !/^\/(?![/\\])/.test(path) ||
    typeof param !== "string" ||
    !/^stats(-\d+)?$/.test(param) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    typeof search !== "string"
  )
    return null;
  const query = new URLSearchParams(search);
  const chosen = query.get(param);
  const active =
    STATS_TABS.find((entry) => entry.value === chosen)?.value ??
    STATS_TABS[0].value;
  query.delete("cursor");
  query.delete("pages");
  const hrefFor = (tab: string) => {
    const next = new URLSearchParams(query);
    if (tab === STATS_TABS[0].value) next.delete(param);
    else next.set(param, tab);
    const text = next.toString();
    return text ? `${path}?${text}` : path;
  };
  return (
    <StatsTabPanel active={active} limit={limit} hrefFor={hrefFor} inPlace />
  );
}
