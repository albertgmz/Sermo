import * as z from "zod";
import { WIDGET_POSITIONS, WIDGET_TYPES, type WidgetType } from "../db/schema";
import { defineContract } from "../operation";
import { Body, Id, Ok, Timestamp } from "./common";
import { CriteriaRule } from "./criteria";
import { THREAD_RANKINGS } from "./feed";

/*
 * The blocks of the public pages are data. A widget sits in one position (to show a block in two
 * places, duplicate it), has a type that decides what it draws and the options that type takes,
 * and may be limited to some viewers with a rule. The widget only says what to draw: the data a
 * block shows comes from the reads it already has (`threads.ranked`, `users.birthdays`, ...).
 */

export const WidgetPosition = z.enum(WIDGET_POSITIONS);
export const WidgetKind = z.enum(WIDGET_TYPES);

/** The pages that draw widgets. */
export const WIDGET_PAGES = ["home", "novedades", "forum", "members"] as const;
export const WidgetPage = z.enum(WIDGET_PAGES);

/**
 * The positions each page draws, in drawing order. The two global positions are on every page
 * that has a widget sidebar: `sidebar_top` opens the right column and `sidebar_bottom` closes it.
 */
export const WIDGET_PAGE_POSITIONS = {
  home: [
    "overview_top",
    "forum_list_above",
    "forum_list_below",
    "overview_bottom",
    "forum_list_sidebar",
    "sidebar_top",
    "sidebar_bottom",
  ],
  novedades: [
    "overview_top",
    "novedades_above",
    "overview_bottom",
    "novedades_sidebar",
    "sidebar_top",
    "sidebar_bottom",
  ],
  forum: ["forum_view_sidebar", "sidebar_top", "sidebar_bottom"],
  members: ["members_sidenav", "sidebar_top", "sidebar_bottom"],
} as const satisfies Record<
  (typeof WIDGET_PAGES)[number],
  readonly (typeof WIDGET_POSITIONS)[number][]
>;

/** The most widgets the site holds. */
export const WIDGET_LIMIT = 100;

const limit = (min: number, max: number, byDefault: number) =>
  z.number().int().min(min).max(max).default(byDefault);

/** The options of each type; a key left out takes its default. */
export const WIDGET_OPTIONS = {
  forumStats: z.strictObject({
    limit: limit(5, 20, 10),
    topPosters: z
      .boolean()
      .default(false)
      .describe("Add the column of the members with most messages."),
  }),
  rankedThreads: z.strictObject({
    by: z.enum(THREAD_RANKINGS).default("mostReacted"),
    limit: limit(1, 20, 5),
  }),
  featured: z.strictObject({}),
  visitorCard: z.strictObject({}),
  monthStandings: z.strictObject({
    limit: limit(1, 10, 5),
    picker: z.boolean().default(true).describe("Offer a year and month to look at another month."),
  }),
  referralLink: z.strictObject({}),
  topReferrers: z.strictObject({ limit: limit(1, 20, 5) }),
  birthdays: z.strictObject({ limit: limit(1, 50, 12) }),
  suggestedMembers: z.strictObject({ limit: limit(1, 12, 4) }),
  forumLinks: z.strictObject({ limit: limit(1, 20, 6) }),
  recentlyActive: z.strictObject({
    window: z
      .enum(["15m", "24h"])
      .default("24h")
      .describe("How far back a member counts as recently active."),
    limit: limit(1, 200, 50).describe("How many names are listed; the rest are counted."),
  }),
  siteTotals: z.strictObject({}),
  text: z.strictObject({ body: Body }),
} as const satisfies Record<WidgetType, z.ZodObject>;

/** Types that are about the signed-in visitor: a guest is not given them. */
export const WIDGET_MEMBERS_ONLY: readonly WidgetType[] = ["visitorCard", "referralLink"];

/** Whether a phone draws a new widget of this type unless told otherwise. */
export const widgetPhonesByDefault = (type: WidgetType): boolean => type !== "visitorCard";

const WidgetTitle = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("Shown above the block; null draws the type's own title.");

/**
 * One member of a union per type: `type` and its `options`, plus `extra` on all of them and
 * `textExtra` on the text type only. For what a client is told; what it sends is below.
 */
function family<E extends z.ZodRawShape, T extends z.ZodRawShape>(extra: E, textExtra: T) {
  const one = <K extends Exclude<WidgetType, "text">, S extends z.ZodObject>(type: K, options: S) =>
    z.object({ type: z.literal(type), options, ...extra });
  return z.discriminatedUnion("type", [
    one("forumStats", WIDGET_OPTIONS.forumStats),
    one("rankedThreads", WIDGET_OPTIONS.rankedThreads),
    one("featured", WIDGET_OPTIONS.featured),
    one("visitorCard", WIDGET_OPTIONS.visitorCard),
    one("monthStandings", WIDGET_OPTIONS.monthStandings),
    one("referralLink", WIDGET_OPTIONS.referralLink),
    one("topReferrers", WIDGET_OPTIONS.topReferrers),
    one("birthdays", WIDGET_OPTIONS.birthdays),
    one("suggestedMembers", WIDGET_OPTIONS.suggestedMembers),
    one("forumLinks", WIDGET_OPTIONS.forumLinks),
    one("recentlyActive", WIDGET_OPTIONS.recentlyActive),
    one("siteTotals", WIDGET_OPTIONS.siteTotals),
    z.object({ type: z.literal("text"), options: WIDGET_OPTIONS.text, ...extra, ...textExtra }),
  ]);
}

const Rendered = { bodyHtml: z.string().describe("The text widget's body, rendered.") };

/** What a visitor is shown: no administrative fields. */
export const Widget = family(
  { id: Id, position: WidgetPosition, title: WidgetTitle.nullable(), phones: z.boolean() },
  Rendered,
).meta({ id: "Widget" });

export const WidgetDetail = family(
  {
    id: Id,
    position: WidgetPosition,
    displayOrder: z.number().int().nonnegative(),
    title: WidgetTitle.nullable(),
    phones: z.boolean(),
    isEnabled: z.boolean(),
    rule: CriteriaRule,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  Rendered,
).meta({ id: "WidgetDetail" });

/**
 * What a client sends. `options` is checked against the options of `type` (below); the REST and
 * MCP adapters read a plain object, so the type does not select a union member here.
 */
const WidgetOptionsInput = z
  .record(z.string(), z.unknown())
  .default({})
  .describe(
    "The options of `type`; a key left out takes its default, an unknown key or an out-of-range " +
      "value is a validation error. forumStats: limit 5-20 (10), topPosters (false). " +
      "rankedThreads: by (mostReacted), limit 1-20 (5). monthStandings: limit 1-10 (5), picker " +
      "(true). topReferrers: limit 1-20 (5). birthdays: limit 1-50 (12). suggestedMembers: " +
      "limit 1-12 (4). forumLinks: limit 1-20 (6). recentlyActive: window 15m or 24h (24h), limit 1-200 (50). " +
      "text: body (BB code, required). featured, visitorCard, referralLink and siteTotals take none.",
  );

function checkOptions(
  input: { type: WidgetType; options: Record<string, unknown> },
  context: z.core.$RefinementCtx,
) {
  const checked = WIDGET_OPTIONS[input.type].safeParse(input.options);
  if (!checked.success)
    for (const issue of checked.error.issues)
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: ["options", ...issue.path],
      });
}

const WidgetCreateInput = z
  .object({
    position: WidgetPosition,
    type: WidgetKind,
    options: WidgetOptionsInput,
    title: WidgetTitle.nullable().default(null),
    phones: z
      .boolean()
      .optional()
      .describe("Whether a phone draws it; on unless the type says otherwise (the visitor card)."),
    isEnabled: z.boolean().default(true),
    rule: CriteriaRule.default({ match: "all", conditions: [] }),
  })
  .superRefine(checkOptions);

const WidgetUpdateInput = z
  .object({
    widgetId: Id,
    position: WidgetPosition,
    type: WidgetKind,
    options: WidgetOptionsInput,
    title: WidgetTitle.nullable(),
    phones: z.boolean(),
    isEnabled: z.boolean(),
    rule: CriteriaRule,
  })
  .superRefine(checkOptions);

export const widgetsCurrent = defineContract({
  name: "widgets.current",
  summary:
    "The widgets a page draws for the viewer: those enabled, in the positions of `page` (and the " +
    "two global sidebar positions), whose rule holds for the viewer, ordered by position as the " +
    "page draws them and then by display order. Each says only what to draw (`type`, `options`, " +
    "`title`, whether `phones` draw it); the block's own data comes from the reads it already " +
    "has. Open to everyone.",
  kind: "read",
  input: z.object({ page: WidgetPage }),
  output: z.object({ items: z.array(Widget) }),
});

export const widgetsList = defineContract({
  name: "widgets.list",
  summary:
    "Every widget, disabled ones included, by position in the order the pages draw them and then " +
    "by display order. Requires admin.widgets.",
  kind: "read",
  input: z.object({}),
  output: z.object({ items: z.array(WidgetDetail) }),
});

export const widgetsCreate = defineContract({
  name: "widgets.create",
  summary:
    "Add a widget at the end of a position. `options` are checked for the `type` (a validation " +
    "error on an unknown or out-of-range key). The rule may only use `cheap` criteria. The site " +
    `holds at most ${WIDGET_LIMIT} widgets. Requires admin.widgets.`,
  kind: "write",
  input: WidgetCreateInput,
  output: WidgetDetail,
});

export const widgetsUpdate = defineContract({
  name: "widgets.update",
  summary:
    "Change a widget; every field is replaced. A widget keeps its type. Moving it to another " +
    "position puts it at the end of that position. Requires admin.widgets.",
  kind: "write",
  input: WidgetUpdateInput,
  output: WidgetDetail,
});

export const widgetsDuplicate = defineContract({
  name: "widgets.duplicate",
  summary:
    "Copy a widget, with its title, options, rule and phone switch, to the end of `position` " +
    "(the widget's own position when left out). Requires admin.widgets.",
  kind: "write",
  input: z.object({ widgetId: Id, position: WidgetPosition.optional() }),
  output: WidgetDetail,
});

export const widgetsReorder = defineContract({
  name: "widgets.reorder",
  summary:
    "Set the order of a position: `ids` must list every widget of the position, once each, " +
    "first to last (a validation error otherwise, and nothing changes). Requires admin.widgets.",
  kind: "write",
  input: z.object({ position: WidgetPosition, ids: z.array(Id).max(WIDGET_LIMIT) }),
  output: Ok,
});

export const widgetsDelete = defineContract({
  name: "widgets.delete",
  summary: "Delete a widget. Requires admin.widgets.",
  kind: "write",
  input: z.object({ widgetId: Id }),
  output: Ok,
});
