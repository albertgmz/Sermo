import type { Credentials, Dependencies } from "./grant-manual-awards-lib";

// The parts of `fcuba-widgets.ts` that the test drives: the plan (a pure function from the rows of
// fcuba's XenForo to Sermo's widgets and the archive forums) and the reconciliation, which talks
// to the API only through an injected `fetch`.

export interface XenforoWidget {
  widgetId: number;
  widgetKey: string;
  definitionId: string;
  /** JSON text: `{"<xenforo position>": <display order>}`, `[]` when the widget is not placed. */
  positions: string;
  /** JSON text of the widget's options, `[]` when it has none. */
  options: string;
  displayCondition: string;
}

export interface XenforoNode {
  nodeId: number;
  parentNodeId: number;
}

export interface Snapshot {
  widgets: XenforoWidget[];
  /** The `_widget_*` templates, by title: the body of XenForo's HTML widgets. */
  templates: { title: string; template: string }[];
  nodes: XenforoNode[];
}

export type Rule = { match: "all"; conditions: { criterion: string; value: number }[] };
const EVERYONE: Rule = { match: "all", conditions: [] };
const MEMBERS: Rule = { match: "all", conditions: [{ criterion: "is_guest", value: 0 }] };
const GUESTS: Rule = { match: "all", conditions: [{ criterion: "is_guest", value: 1 }] };

export interface PlannedWidget {
  position: string;
  type: string;
  options: Record<string, unknown>;
  title: string | null;
  rule: Rule;
  /** What it comes from, for the printed plan. */
  source: string;
}

export interface Skipped {
  source: string;
  reason: string;
}

export interface Plan {
  /** In drawing order within each position (the order of this list). */
  widgets: PlannedWidget[];
  skipped: Skipped[];
  excludedForumIds: number[];
}

/** XenForo's widget positions that Sermo draws, by the position that takes their place. */
const POSITIONS: Record<string, string> = {
  forum_overview_top: "overview_top",
  forum_overview_bottom: "overview_bottom",
  forum_list_above_nodes: "forum_list_above",
  forum_list_below_nodes: "forum_list_below",
  forum_list_sidebar: "forum_list_sidebar",
  forum_view_sidebar: "forum_view_sidebar",
  category_view_sidebar: "forum_view_sidebar",
  forum_new_posts_sidebar: "whats_new_sidebar",
  whats_new_sidebar: "whats_new_sidebar",
  whats_new_overview: "whats_new_above",
  member_wrapper_sidenav: "members_sidenav",
};

type Mapped = { type: string; options?: Record<string, unknown>; title?: string; rule?: Rule };
type Mapper = (options: Record<string, unknown>, xf: XenforoWidget, snapshot: Snapshot) => Mapped;

const clamp = (value: unknown, min: number, max: number, byDefault: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : byDefault;

/** The type that takes the place of each XenForo widget definition; absent ones are not brought. */
const DEFINITIONS: Record<string, Mapper> = {
  featured_content: () => ({ type: "featured" }),
  forum_statistics: () => ({ type: "siteTotals" }),
  visitor_panel: () => ({ type: "visitorCard" }),
  members_online: (o) => ({
    type: "recentlyActive",
    options: { window: "15m", limit: clamp(o.limit, 1, 200, 50) },
    rule: MEMBERS,
  }),
  membersRecentlyOnline: () => ({ type: "recentlyActive", options: { window: "24h", limit: 50 } }),
  wutc_widget: (o) => ({
    type: "monthStandings",
    options: { limit: clamp(o.limit, 1, 10, 5), picker: true },
  }),
  siropu_referral_link: () => ({ type: "referralLink" }),
  siropu_referral_top_ref: (o) => ({
    type: "topReferrers",
    options: { limit: clamp(o.limit, 1, 20, 5) },
  }),
  trending_content: (o) => ({
    type: "rankedThreads",
    options: { by: "mostReacted", limit: clamp(o.limit, 1, 20, 5) },
  }),
  birthdays: (o) => ({ type: "birthdays", options: { limit: clamp(o.limit, 1, 50, 12) } }),
  html: (o, xf, snapshot) => {
    const template = snapshot.templates.find((t) => t.title === o.template_title);
    if (!template) throw new Error(`the template ${String(o.template_title)} is not in the data`);
    return { type: "text", options: { body: bbOf(template.template) }, title: titleOf(xf) };
  },
};

/** The widget title XenForo shows, from its phrase; only the HTML widgets need one here. */
const HTML_TITLES: Record<string, string> = { registrate_whats_new: "Regístrate" };
const titleOf = (xf: XenforoWidget) => HTML_TITLES[xf.widgetKey] ?? xf.widgetKey;

/**
 * The text of a XenForo HTML template as the plain BB code a text widget takes. The stored
 * template has `?` where the inverted opening mark and the closing mark of the sentence were.
 */
function bbOf(template: string): string {
  const text = template.replace(/<\/?p>/g, "").trim();
  return text.replace(/^\?/, "¡").replace(/\?$/, "!");
}

const DISPLAY_RULES: Record<string, Rule> = {
  "": EVERYONE,
  "$xf.visitor.user_id": MEMBERS,
  "!$xf.visitor.user_id": GUESTS,
};

const parseJson = (text: string): Record<string, unknown> => {
  const value = JSON.parse(text || "[]") as unknown;
  return Array.isArray(value) ? {} : (value as Record<string, unknown>);
};

/**
 * The forum statistics panel is no XenForo widget: an add-on drew it full width above the forum
 * list. It opens `forum_list_top` (the home page only, not What's new: the owner), with the members
 * who post most.
 */
const STATISTICS: PlannedWidget = {
  position: "forum_list_top",
  type: "forumStats",
  options: { limit: 10, topPosters: true },
  title: null,
  rule: EVERYONE,
  source: "the statistics panel of the capture (no XenForo widget)",
};

/** The archive forums: node 65 and the nodes 433-664 (the owner's decision). */
const ARCHIVE_FIRST = 433;
const ARCHIVE_LAST = 664;
const ARCHIVE_ROOT = 65;

/**
 * The archive nodes whose parent is not an archive node. A forum left out of the feed is left out
 * with its subforums, so these few cover every archive node and stay under the setting's limit.
 */
export function archiveParents(nodes: XenforoNode[]): number[] {
  const inArchive = (id: number) =>
    id === ARCHIVE_ROOT || (id >= ARCHIVE_FIRST && id <= ARCHIVE_LAST);
  return nodes
    .filter((n) => inArchive(n.nodeId) && !inArchive(n.parentNodeId))
    .map((n) => n.nodeId)
    .sort((a, b) => a - b);
}

export function planFromXenforo(snapshot: Snapshot): Plan {
  const placed: { widget: PlannedWidget; order: number; id: number }[] = [
    { widget: STATISTICS, order: -1, id: 0 },
  ];
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  const sorted = [...snapshot.widgets].sort((a, b) => a.widgetId - b.widgetId);
  for (const xf of sorted) {
    const source = `${xf.widgetKey} (${xf.definitionId})`;
    const positions = Object.entries(parseJson(xf.positions));
    if (positions.length === 0) {
      skipped.push({ source, reason: "not placed on any page" });
      continue;
    }
    const mapper = DEFINITIONS[xf.definitionId];
    if (!mapper) {
      skipped.push({ source, reason: "no Sermo widget of this kind" });
      continue;
    }
    for (const [xfPosition, order] of positions) {
      const position = POSITIONS[xfPosition];
      const where = `${source} in ${xfPosition}`;
      if (!position) {
        skipped.push({ source: where, reason: "no Sermo position" });
        continue;
      }
      const display = DISPLAY_RULES[xf.displayCondition.trim()];
      if (!display) {
        skipped.push({
          source: where,
          reason: `display condition ${xf.displayCondition} is not brought`,
        });
        continue;
      }
      const mapped = mapper(parseJson(xf.options), xf, snapshot);
      if (position === "whats_new_sidebar" && mapped.type === "rankedThreads") {
        skipped.push({ source: where, reason: "no Trending in whats_new_sidebar (owner)" });
        continue;
      }
      if (position === "whats_new_above" && mapped.type !== "text") {
        skipped.push({ source: where, reason: "whats_new_above takes the guests' note only" });
        continue;
      }
      const widget: PlannedWidget = {
        position,
        type: mapped.type,
        options: mapped.options ?? {},
        title: mapped.title ?? null,
        rule: mapped.rule ?? display,
        source: where,
      };
      const key = widgetKey(widget);
      if (seen.has(key)) {
        skipped.push({ source: where, reason: "the same widget is already planned there" });
        continue;
      }
      seen.add(key);
      placed.push({ widget, order: Number(order), id: xf.widgetId });
    }
  }
  placed.sort((a, b) => a.order - b.order || a.id - b.id);
  // Grouped by position (in the order each first appears), display order kept inside each.
  const positionsInOrder = [...new Set(placed.map((p) => p.widget.position))];
  placed.sort(
    (a, b) =>
      positionsInOrder.indexOf(a.widget.position) - positionsInOrder.indexOf(b.widget.position),
  );
  return {
    widgets: placed.map((p) => p.widget),
    skipped,
    excludedForumIds: archiveParents(snapshot.nodes),
  };
}

export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Partial<Snapshot>;
  if (!Array.isArray(data.widgets) || !Array.isArray(data.templates) || !Array.isArray(data.nodes))
    throw new Error("The snapshot needs widgets, templates and nodes.");
  return data as Snapshot;
}

/** Keys sorted, so equal values written in another order are the same. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** What makes a widget "the same one": where it is, what it is, how it is set and who sees it. */
export function widgetKey(w: {
  position: string;
  type: string;
  options: object;
  title: string | null;
  rule: object;
}): string {
  return stable([w.position, w.type, w.options, w.title, w.rule]);
}

/**
 * The widgets a new site starts with (migration 0066). Those that sit untouched and are not in
 * the plan are switched off, as the plan has its own statistics, featured threads and sidebar.
 */
const SEEDS: [string, string, object][] = [
  ["forum_list_above", "forumStats", { limit: 10, topPosters: false }],
  ["whats_new_above", "featured", {}],
  ["whats_new_sidebar", "rankedThreads", { by: "mostReacted", limit: 5 }],
  ["whats_new_sidebar", "rankedThreads", { by: "latestThreads", limit: 5 }],
  ["whats_new_sidebar", "suggestedMembers", { limit: 4 }],
  ["whats_new_sidebar", "forumLinks", { limit: 6 }],
];
const SEED_KEYS = new Set(
  SEEDS.map(([p, t, o]) =>
    widgetKey({ position: p, type: t, options: o, title: null, rule: EVERYONE }),
  ),
);

export interface LiveWidget {
  id: number;
  position: string;
  type: string;
  displayOrder: number;
  title: string | null;
  options: Record<string, unknown>;
  rule: Rule;
  phones: boolean;
  isEnabled: boolean;
}

export interface LiveNode {
  id: number;
}

export interface Options {
  url: string;
  dryRun: boolean;
  snapshotFile: string;
}

export interface Report {
  created: number;
  kept: number;
  disabled: number;
  reordered: number;
  /** Widgets that are neither the plan's nor an untouched starting one: left alone. */
  foreign: number;
  forumsAdded: number;
  forumsMissing: number[];
}

const WRITE_GAP_MS = 350;
const MAX_RATE_LIMIT_WAITS = 5;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

class Aborted extends Error {}

export async function reconcile(
  options: Pick<Options, "url" | "dryRun">,
  credentials: Credentials | null,
  plan: Plan,
  deps: Dependencies,
): Promise<Report> {
  const report: Report = {
    created: 0,
    kept: 0,
    disabled: 0,
    reordered: 0,
    foreign: 0,
    forumsAdded: 0,
    forumsMissing: [],
  };
  const base = options.url.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "sermo-fcuba-widgets",
    ...(credentials && "apiKey" in credentials
      ? { "x-api-key": credentials.apiKey }
      : credentials
        ? { cookie: credentials.cookie, origin: new URL(base).origin }
        : {}),
  };
  let lastWrite = Number.NEGATIVE_INFINITY;
  const call = async (method: string, path: string, body?: object): Promise<Response> => {
    for (let waits = 0; ; waits++) {
      if (method !== "GET") {
        const wait = lastWrite + WRITE_GAP_MS - performance.now();
        if (wait > 0) await deps.sleep(wait);
        lastWrite = performance.now();
      }
      const response = await deps.fetch(`${base}/api/v1${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 || response.status === 403)
        throw new Aborted(
          `${method} ${path} answered ${response.status}: the credential is not an administrator's.`,
        );
      if (response.status !== 429) return response;
      if (waits >= MAX_RATE_LIMIT_WAITS) throw new Aborted("The API keeps answering 429.");
      const seconds = Number(
        response.headers.get("retry-after") ?? response.headers.get("ratelimit-reset"),
      );
      await deps.sleep(seconds > 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_WAIT_MS);
    }
  };
  const send = async <T>(method: string, path: string, body?: object): Promise<T> => {
    const response = await call(method, path, body);
    if (!response.ok) {
      const message = (
        (await response.json().catch(() => null)) as { error?: { message?: string } } | null
      )?.error?.message;
      throw new Aborted(
        `${method} ${path} answered ${response.status}${message ? `: ${message}` : ""}.`,
      );
    }
    return (await response.json()) as T;
  };
  const verb = options.dryRun ? "would" : "did";

  const live = credentials
    ? (await send<{ items: LiveWidget[] }>("GET", "/widgets/all")).items
    : [];
  const byKey = new Map(live.map((w) => [widgetKey(w), w]));
  const planned = new Set(plan.widgets.map(widgetKey));

  // Widgets: add what is missing, in the order of the plan.
  const ids = new Map<string, number | null>();
  for (const widget of plan.widgets) {
    const key = widgetKey(widget);
    const existing = byKey.get(key);
    if (existing) {
      ids.set(key, existing.id);
      report.kept++;
      deps.log(`keep    ${widget.position} ${widget.type} (${widget.source})`);
      continue;
    }
    deps.log(
      `${verb === "would" ? "create " : "created"} ${widget.position} ${widget.type} ${stable(widget.options)} (${widget.source})`,
    );
    report.created++;
    if (options.dryRun) {
      ids.set(key, null);
      continue;
    }
    const { source: _source, ...input } = widget;
    ids.set(key, (await send<{ id: number }>("POST", "/widgets", input)).id);
  }

  // The order of each position: the plan's widgets first, the others after, as they were.
  const positions = [...new Set(plan.widgets.map((w) => w.position))];
  for (const position of credentials ? positions : []) {
    const wanted = plan.widgets
      .filter((w) => w.position === position)
      .map((w) => ids.get(widgetKey(w)));
    const others = live
      .filter((w) => w.position === position && !planned.has(widgetKey(w)))
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id)
      .map((w) => w.id);
    const current = live
      .filter((w) => w.position === position)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id)
      .map((w) => w.id);
    const full = [...wanted, ...others];
    const unchanged = full.length === current.length && full.every((id, i) => id === current[i]);
    if (unchanged) continue;
    report.reordered++;
    deps.log(`${verb === "would" ? "order  " : "ordered"} ${position}`);
    if (!options.dryRun) await send("PUT", "/widgets/order", { position, ids: full });
  }

  // The starting widgets the plan replaces are switched off; any other widget is left as it is.
  for (const widget of live) {
    const key = widgetKey(widget);
    if (planned.has(key)) continue;
    const untouched = SEED_KEYS.has(key) && widget.phones && widget.title === null;
    if (!untouched) {
      report.foreign++;
      deps.log(`left    ${widget.position} ${widget.type} #${widget.id}: not made by this script`);
      continue;
    }
    if (!widget.isEnabled) continue;
    report.disabled++;
    deps.log(
      `${verb === "would" ? "disable" : "disabled"} ${widget.position} ${widget.type} #${widget.id}: a starting widget the plan replaces`,
    );
    if (options.dryRun) continue;
    const { id, displayOrder: _o, ...fields } = widget as LiveWidget & Record<string, unknown>;
    await send("PATCH", `/widgets/${id}`, {
      position: fields.position,
      type: fields.type,
      options: fields.options,
      title: fields.title,
      phones: fields.phones,
      isEnabled: false,
      rule: fields.rule,
    });
  }

  // The archive forums leave the feed; ids already in the setting stay.
  if (credentials) {
    const forums = new Set(
      (await send<{ items: LiveNode[] }>("GET", "/nodes")).items.map((n) => n.id),
    );
    const current = (await send<{ feedExcludedForumIds: number[] }>("GET", "/settings"))
      .feedExcludedForumIds;
    const present = plan.excludedForumIds.filter((id) => forums.has(id));
    report.forumsMissing = plan.excludedForumIds.filter((id) => !forums.has(id));
    const missing = present.filter((id) => !current.includes(id));
    for (const id of report.forumsMissing) deps.log(`forum ${id} does not exist here: skipped`);
    if (missing.length > 0) {
      report.forumsAdded = missing.length;
      deps.log(
        `${verb === "would" ? "exclude" : "excluded"} forums ${missing.join(", ")} from the feed`,
      );
      if (!options.dryRun)
        await send("PATCH", "/settings", {
          feedExcludedForumIds: [...new Set([...current, ...missing])],
        });
    }
  } else deps.log(`feed excludes forums ${plan.excludedForumIds.join(", ")} (live state not read)`);
  return report;
}

export function formatPlan(plan: Plan): string {
  const lines = ["Widgets, per position in drawing order:"];
  for (const w of plan.widgets)
    lines.push(
      `  ${w.position.padEnd(18)} ${w.type.padEnd(16)} ${stable(w.options)}${w.title ? ` title "${w.title}"` : ""}${w.rule.conditions.length ? ` rule ${stable(w.rule.conditions)}` : ""}  <- ${w.source}`,
    );
  lines.push("Not brought:");
  for (const s of plan.skipped) lines.push(`  ${s.source}: ${s.reason}`);
  lines.push(`Archive forums left out of the feed: ${plan.excludedForumIds.join(", ")}`);
  return lines.join("\n");
}
