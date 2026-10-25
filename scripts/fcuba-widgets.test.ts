import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Ctx, closeContext, ensureAdmin } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "../packages/api/src/app";
import {
  archiveParents,
  type Plan,
  parseSnapshot,
  planFromXenforo,
  reconcile,
  type Snapshot,
} from "./fcuba-widgets-lib";
import type { Dependencies } from "./grant-manual-awards-lib";

const widget = (widgetId: number, widgetKey: string, definitionId: string, extra: object = {}) => ({
  widgetId,
  widgetKey,
  definitionId,
  positions: "[]",
  options: "[]",
  displayCondition: "",
  ...extra,
});

const fixture: Snapshot = {
  widgets: [
    widget(1, "birthdays", "birthdays", {
      positions: '{"forum_list_sidebar":"99"}',
      options: '{"limit":999}',
    }),
    widget(2, "visitors", "visitor_panel", { positions: '{"forum_list_sidebar":"1"}' }),
    widget(3, "trending", "trending_content", {
      positions: '{"forum_list_sidebar":20,"whats_new_sidebar":20,"forum_new_posts_sidebar":20}',
      options: '{"limit":5,"style":"simple"}',
    }),
    widget(4, "online", "members_online", {
      positions: '{"forum_list_below_nodes":"1"}',
      displayCondition: "$xf.visitor.user_id",
      options: '{"limit":50}',
    }),
    widget(5, "welcome", "html", {
      positions: '{"whats_new_overview":"0"}',
      displayCondition: "!$xf.visitor.user_id",
      options: '{"template_title":"_widget_welcome"}',
    }),
    widget(6, "unplaced", "birthdays"),
    widget(7, "newest", "newest_members", { positions: '{"member_wrapper_sidenav":"20"}' }),
    widget(8, "tie_b", "siropu_referral_top_ref", { positions: '{"forum_list_sidebar":"10"}' }),
    widget(9, "tie_a", "siropu_referral_link", { positions: '{"forum_list_sidebar":"10"}' }),
  ],
  templates: [{ title: "_widget_welcome", template: "<p>?Hola a todos.?</p>" }],
  nodes: [
    { nodeId: 61, parentNodeId: 0 },
    { nodeId: 65, parentNodeId: 61 },
    { nodeId: 70, parentNodeId: 65 },
    { nodeId: 433, parentNodeId: 61 },
    { nodeId: 434, parentNodeId: 433 },
    { nodeId: 441, parentNodeId: 672 },
    { nodeId: 442, parentNodeId: 441 },
    { nodeId: 672, parentNodeId: 61 },
    { nodeId: 700, parentNodeId: 61 },
  ],
};

const placement = (plan: Plan) => plan.widgets.map((w) => `${w.position}:${w.type}`);

describe("the plan from XenForo's rows", () => {
  const plan = planFromXenforo(fixture);

  test("each placed widget lands in the Sermo position of its XenForo one, in display order, ties by id", () => {
    expect(placement(plan)).toEqual([
      "forum_list_top:forumStats",
      "whats_new_above:text",
      "forum_list_sidebar:visitorCard",
      "forum_list_sidebar:topReferrers",
      "forum_list_sidebar:referralLink",
      "forum_list_sidebar:rankedThreads",
      "forum_list_sidebar:birthdays",
      "forum_list_below:recentlyActive",
    ]);
  });

  test("options are clamped, the display condition becomes a rule, the template becomes the text", () => {
    const byType = (type: string) => plan.widgets.find((w) => w.type === type)!;
    expect(byType("birthdays").options).toEqual({ limit: 50 });
    expect(byType("recentlyActive")).toMatchObject({
      options: { window: "15m", limit: 50 },
      rule: { conditions: [{ criterion: "is_guest", value: 0 }] },
    });
    expect(byType("text")).toMatchObject({
      title: "welcome",
      options: { body: "¡Hola a todos.!" },
      rule: { conditions: [{ criterion: "is_guest", value: 1 }] },
    });
    expect(byType("forumStats").options).toEqual({ limit: 10, topPosters: true });
  });

  test("trending never lands in whats_new_sidebar, and what has no Sermo widget is listed as skipped", () => {
    expect(plan.widgets.some((w) => w.position === "whats_new_sidebar")).toBe(false);
    const reasons = plan.skipped.map((s) => `${s.source}: ${s.reason}`);
    expect(reasons).toContain(
      "trending (trending_content) in whats_new_sidebar: no Trending in whats_new_sidebar (owner)",
    );
    expect(reasons).toContain("unplaced (birthdays): not placed on any page");
    expect(reasons).toContain("newest (newest_members): no Sermo widget of this kind");
  });

  test("the feed leaves out the archive parents only: node 65 and the roots of 433-664, not their children", () => {
    expect(archiveParents(fixture.nodes)).toEqual([65, 433, 441]);
    expect(plan.excludedForumIds).toEqual([65, 433, 441]);
  });
});

describe("fcuba's real snapshot", () => {
  const snapshot = parseSnapshot(
    readFileSync(join(import.meta.dir, "fcuba-widgets-snapshot.json"), "utf8"),
  );
  const plan = planFromXenforo(snapshot);

  test("places the widgets of fcuba's layout, statistics first at the top and no Trending or Latest threads in the feed sidebar", () => {
    expect(placement(plan)).toEqual([
      "forum_list_top:forumStats",
      "whats_new_above:text",
      "overview_top:featured",
      "forum_list_below:recentlyActive",
      "forum_list_sidebar:visitorCard",
      "forum_list_sidebar:monthStandings",
      "forum_list_sidebar:referralLink",
      "forum_list_sidebar:topReferrers",
      "forum_list_sidebar:rankedThreads",
      "forum_list_sidebar:birthdays",
      "whats_new_sidebar:monthStandings",
      "whats_new_sidebar:recentlyActive",
      "overview_bottom:siteTotals",
    ]);
  });

  test("sets the five archive parents of the real node tree", () => {
    expect(plan.excludedForumIds).toEqual([65, 433, 441, 620, 634]);
  });
});

// --- against a real site

const origin = "http://localhost:3000";
const password = "Password123!";
const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function site() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const env = { requestIP: () => ({ address: "10.1.1.1", family: "IPv4" as const, port: 1 }) };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const auth = (path: string, body: object, cookie?: string) =>
    request(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  await ensureAdmin(ctx, { username: "admin", email: "admin@example.test", password });
  const signedIn = await auth("/sign-in/email", { email: "admin@example.test", password });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const created = await auth("/api-key/create", { name: "widgets", password }, cookie);
  const apiKey = ((await created.json()) as { key: string }).key;
  const api = async (method: string, path: string, body?: object) => {
    const response = await request(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return response.json() as Promise<Json>;
  };
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: Dependencies = {
    fetch: async (url, init) => {
      const target = new URL(url);
      calls.push(`${init.method} ${target.pathname}`);
      return request(target.pathname + target.search, init);
    },
    sleep: async () => {},
    log: (line) => logs.push(line),
  };
  return { api, apiKey, deps, calls, logs };
}

type Row = { id: number; position: string; type: string; isEnabled: boolean };
type Json = { id: number; items: Row[]; feedExcludedForumIds: number[] };
const writes = (calls: string[]) => calls.filter((c) => !c.startsWith("GET"));

describe("placing the widgets on a site", () => {
  const snapshot = parseSnapshot(
    readFileSync(join(import.meta.dir, "fcuba-widgets-snapshot.json"), "utf8"),
  );

  async function prepared() {
    const s = await site();
    const archive = await s.api("POST", "/nodes", {
      parentId: null,
      type: "category",
      title: "Archive",
    });
    const child = await s.api("POST", "/nodes", {
      parentId: archive.id,
      type: "forum",
      title: "Old",
    });
    const plan = { ...planFromXenforo(snapshot), excludedForumIds: [archive.id, 9999] };
    return { ...s, plan, archive, child };
  }
  const options = (dryRun: boolean) => ({ url: origin, dryRun });
  const layout = async (api: ReturnType<typeof site> extends Promise<infer T> ? T["api"] : never) =>
    (await api("GET", "/widgets/all")).items.map(
      (w) => `${w.position}:${w.type}:${w.isEnabled ? "on" : "off"}`,
    );

  test("a first run creates the planned widgets in order and switches off the starting ones it replaces; a second run writes nothing", async () => {
    const s = await prepared();
    const first = await reconcile(options(false), { apiKey: s.apiKey }, s.plan, s.deps);
    expect(first).toMatchObject({
      created: 13,
      disabled: 5,
      foreign: 0,
      forumsAdded: 1,
      forumsMissing: [9999],
    });
    const all = (await s.api("GET", "/widgets/all")).items;
    const sidebar = all.filter((w) => w.position === "forum_list_sidebar").map((w) => w.type);
    expect(sidebar).toEqual([
      "visitorCard",
      "monthStandings",
      "referralLink",
      "topReferrers",
      "rankedThreads",
      "birthdays",
    ]);
    expect(
      all.filter((w) => w.isEnabled && w.position === "whats_new_sidebar").map((w) => w.type),
    ).toEqual(["monthStandings", "recentlyActive"]);
    expect((await s.api("GET", "/settings")).feedExcludedForumIds).toEqual([s.archive.id]);

    const before = await layout(s.api);
    s.calls.length = 0;
    const second = await reconcile(options(false), { apiKey: s.apiKey }, s.plan, s.deps);
    expect(second).toMatchObject({ created: 0, disabled: 0, reordered: 0, forumsAdded: 0 });
    expect(writes(s.calls)).toEqual([]);
    expect(await layout(s.api)).toEqual(before);
  });

  test("a dry run writes nothing but says what it would do", async () => {
    const s = await prepared();
    const before = await layout(s.api);
    const report = await reconcile(options(true), { apiKey: s.apiKey }, s.plan, s.deps);
    expect(report).toMatchObject({ created: 13, disabled: 5, forumsAdded: 1 });
    expect(writes(s.calls)).toEqual([]);
    expect(await layout(s.api)).toEqual(before);
    expect((await s.api("GET", "/settings")).feedExcludedForumIds).toEqual([]);
    expect(s.logs).toContain(`exclude forums ${s.archive.id} from the feed`);
  });

  test("a widget the script did not make stays where it is, after the planned ones, and is listed; excluded forums already set stay", async () => {
    const s = await prepared();
    const own = await s.api("POST", "/widgets", {
      position: "forum_list_sidebar",
      type: "text",
      title: "Notice",
      options: { body: "Hello" },
    });
    await s.api("PATCH", "/settings", { feedExcludedForumIds: [s.child.id] });
    const report = await reconcile(options(false), { apiKey: s.apiKey }, s.plan, s.deps);
    expect(report.foreign).toBe(1);
    expect(s.logs).toContain(`left    forum_list_sidebar text #${own.id}: not made by this script`);
    const sidebar = (await s.api("GET", "/widgets/all")).items.filter(
      (w) => w.position === "forum_list_sidebar",
    );
    expect(sidebar.at(-1).id).toBe(own.id);
    expect((await s.api("GET", "/settings")).feedExcludedForumIds.sort()).toEqual(
      [s.archive.id, s.child.id].sort(),
    );
  });
});
