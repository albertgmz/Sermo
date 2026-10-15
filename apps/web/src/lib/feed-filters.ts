import {
  FEED_FILTER_FORUMS,
  FEED_THREAD_TYPES,
  type FeedFilter,
} from "@sermo/core/contracts";
import type * as z from "zod";
import { type HomeTab, homeHref } from "@/lib/home-tabs";

// The fields that narrow the home feed, as the address carries them: `forums` (ids, comma
// separated), `prefix`, `type`, `tag`, `watched=1` and `unread=1`. Pure, so the rules are held by
// tests; the backend decides what a field means and who may use it.
export type FeedFilterValue = z.output<typeof FeedFilter>;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
const WHOLE = /^\d{1,9}$/;

// The filter an address names. A field that is malformed or unknown is left out, never an error:
// an old link keeps working with what still makes sense.
export function filterFromParams(params: Params): FeedFilterValue {
  const filter: FeedFilterValue = {};
  const forums = [
    ...new Set(
      (first(params.forums) ?? "")
        .split(",")
        .filter((id) => WHOLE.test(id))
        .map(Number)
        .filter((id) => id > 0),
    ),
  ].slice(0, FEED_FILTER_FORUMS);
  if (forums.length > 0) filter.forumIds = forums;
  const prefix = first(params.prefix);
  if (prefix && WHOLE.test(prefix) && Number(prefix) > 0)
    filter.prefixId = Number(prefix);
  const type = FEED_THREAD_TYPES.find((value) => value === first(params.type));
  if (type) filter.type = type;
  const tag = (first(params.tag) ?? "").trim().slice(0, 100);
  if (tag) filter.tag = tag;
  if (first(params.watched) === "1") filter.watched = true;
  if (first(params.unread) === "1") filter.unread = true;
  return filter;
}

// The parameters of a filter, in a fixed order so the same filter is the same address.
export function filterParams(filter: FeedFilterValue): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.forumIds && filter.forumIds.length > 0)
    params.set("forums", filter.forumIds.join(","));
  if (filter.prefixId !== undefined)
    params.set("prefix", String(filter.prefixId));
  if (filter.type) params.set("type", filter.type);
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.watched) params.set("watched", "1");
  if (filter.unread) params.set("unread", "1");
  return params;
}

export const isFiltered = (filter: FeedFilterValue) =>
  filterParams(filter).toString() !== "";

// What a list is called in the browser's memory for this filter.
export const filterKey = (filter: FeedFilterValue) =>
  filterParams(filter).toString();

// The address of a tab with a filter on it.
export function feedHref(tab: HomeTab, filter: FeedFilterValue = {}) {
  const params = filterParams(filter).toString();
  return params ? `${homeHref(tab)}&${params}` : homeHref(tab);
}

// The filter without one of its fields, for the chip that takes that field off. A forum chip takes
// off that forum only.
export function without(
  filter: FeedFilterValue,
  field: keyof FeedFilterValue,
  forumId?: number,
): FeedFilterValue {
  const { [field]: _removed, ...rest } = filter;
  if (field === "forumIds" && forumId !== undefined) {
    const forums = (filter.forumIds ?? []).filter((id) => id !== forumId);
    return forums.length > 0 ? { ...rest, forumIds: forums } : rest;
  }
  return rest;
}

// The forums of a depth-first list (a forum after its category, each with its depth) without the
// ones the site leaves out of the feed and everything under them: naming those lists nothing.
export function withoutExcluded<T extends { id: number; depth: number }>(
  forums: T[],
  excluded: readonly number[],
): T[] {
  const kept: T[] = [];
  let skipping: number | null = null;
  for (const forum of forums) {
    if (skipping !== null && forum.depth > skipping) continue;
    skipping = null;
    if (excluded.includes(forum.id)) {
      skipping = forum.depth;
      continue;
    }
    kept.push(forum);
  }
  return kept;
}
