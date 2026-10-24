// Which page links a numbered pager shows, as XenForo's `page_nav` does: the first page, the pages
// within `range` of the current one, the last page. A gap of one page shows that page; a longer
// gap is a skip ("…") that opens "go to page", filled with the page next to the window.

export type WindowEntry =
  | { kind: "page"; page: number }
  | { kind: "skip"; jump: number };

// The pager on a wide screen shows two pages either side of the current one (XenForo's default);
// a phone shows one, so the bar fits 390 px with four-digit page numbers.
export const WIDE_RANGE = 2;
export const NARROW_RANGE = 1;

export function pageWindow(
  current: number,
  total: number,
  range: number,
): WindowEntry[] {
  if (total <= 1) return [];
  const page = Math.max(1, Math.min(current, total));
  const startInner = Math.max(2, page - range);
  const endInner = Math.min(page + range, total - 1);
  const entries: WindowEntry[] = [{ kind: "page", page: 1 }];
  if (startInner === 3) entries.push({ kind: "page", page: 2 });
  else if (startInner > 3) entries.push({ kind: "skip", jump: startInner - 1 });
  for (let inner = startInner; inner <= endInner; inner += 1)
    entries.push({ kind: "page", page: inner });
  if (endInner + 2 === total) entries.push({ kind: "page", page: total - 1 });
  else if (endInner + 2 < total)
    entries.push({ kind: "skip", jump: endInner + 1 });
  entries.push({ kind: "page", page: total });
  return entries;
}

// One entry of the drawn pager and on which screens it shows.
export type PagerEntry = WindowEntry & { wide: boolean; narrow: boolean };

// The wide and the narrow window in one bar, each entry marked with the screens it shows on, so the
// page holds one pager whose entries a breakpoint hides.
export function pagerEntries(current: number, total: number): PagerEntry[] {
  const placed = new Map<number, PagerEntry>();
  for (const [range, screen] of [
    [WIDE_RANGE, "wide"],
    [NARROW_RANGE, "narrow"],
  ] as const) {
    // A page sits at its number, a skip just after the page before it. The two windows' skips
    // never share a place: each opens at the page next to its own window.
    let before = 0;
    for (const entry of pageWindow(current, total, range)) {
      const place =
        entry.kind === "page"
          ? entry.page
          : before + (screen === "wide" ? 0.5 : 0.25);
      if (entry.kind === "page") before = entry.page;
      const held = placed.get(place) ?? {
        ...entry,
        wide: false,
        narrow: false,
      };
      held[screen] = true;
      placed.set(place, held);
    }
  }
  return [...placed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => entry);
}

// The pages a thread row links to beside its title, as XenForo's `last_pages` with its default of
// three: the last pages of the thread, never the first (the title opens it).
export function lastPages(total: number, count = 3): number[] {
  if (total <= 1) return [];
  const pages: number[] = [];
  for (let page = Math.max(total - count + 1, 2); page <= total; page += 1)
    pages.push(page);
  return pages;
}

// The page "go to page" goes to: a whole number brought within the pages, or null for anything
// that is not a number (nothing happens, as in XenForo).
export function jumpPage(raw: string, total: number): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  return Math.max(1, Math.min(Number(text), total));
}

export type PageParams = Record<string, string | string[] | undefined>;

// The address of a page of a list: the path and the list's other parameters, with `param` set to
// the page (left out for the first page, so page one has one address).
export function pageAddress(
  path: string,
  params: PageParams,
  page: number,
  param = "page",
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === param || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value])
      query.append(key, item);
  }
  if (page > 1) query.set(param, String(page));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

// The page an address (its search part) names, 1 when it names none or nonsense.
export function pageOfSearch(search: string, param = "page") {
  const raw = new URLSearchParams(search).get(param);
  return Math.max(1, Math.floor(Number(raw)) || 1);
}
