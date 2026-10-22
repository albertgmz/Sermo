import type { BenchEnv, Scenario } from "../harness";

const TITLE = "Bench widget";
const RULES = [
  { match: "all", conditions: [] },
  { match: "all", conditions: [{ criterion: "is_guest", value: 1 }] },
  { match: "all", conditions: [{ criterion: "is_guest", value: 0 }] },
  { match: "all", conditions: [{ criterion: "post_count", value: 5 }] },
];

let ids: number[] = [];
let ready: unknown;

/** Finds the widgets the scenarios work on (an earlier run may have left them) or makes them. */
async function ensure(env: BenchEnv): Promise<void> {
  if (ready === env.ctx) return;
  const held = env.ctx.sqlite
    .prepare<{ id: number }, [string]>(
      "SELECT id FROM widgets WHERE title = ?1 ORDER BY display_order, id",
    )
    .all(TITLE);
  if (held.length === RULES.length) ids = held.map((row) => row.id);
  else {
    ids = [];
    for (const rule of RULES) {
      const made = JSON.parse(
        (await env.call("widgets.create", env.actors.admin, {
          position: "forum_list_sidebar",
          type: "birthdays",
          title: TITLE,
          rule,
        })) as string,
      ) as { id: number };
      ids.push(made.id);
    }
  }
  ready = env.ctx;
}

export const scenarios: Scenario[] = [
  {
    name: "widgets.current guest home",
    kind: "read",
    setup: ensure,
    run: (env) => env.call("widgets.current", env.actors.guest, { page: "home" }),
  },
  {
    name: "widgets.current member home",
    kind: "read",
    run: (env, i) => env.call("widgets.current", env.actors.member(i), { page: "home" }),
  },
  {
    name: "widgets.current guest novedades",
    kind: "read",
    run: (env) => env.call("widgets.current", env.actors.guest, { page: "novedades" }),
  },
  {
    name: "widgets.current member novedades",
    kind: "read",
    run: (env, i) => env.call("widgets.current", env.actors.member(i), { page: "novedades" }),
  },
  {
    name: "widgets.list",
    kind: "read",
    run: (env) => env.call("widgets.list", env.actors.admin, {}),
  },
  {
    name: "widgets.update",
    kind: "write",
    setup: ensure,
    run: (env, i) =>
      env.call("widgets.update", env.actors.admin, {
        widgetId: ids[0],
        type: "birthdays",
        position: "forum_list_sidebar",
        title: TITLE,
        phones: true,
        isEnabled: true,
        rule: RULES[0],
        options: { limit: 1 + (i % 50) },
      }),
  },
  {
    name: "widgets.reorder",
    kind: "write",
    setup: ensure,
    run: (env, i) => {
      // Each request turns the order one place round, so each one changes the stored order.
      const turn = i % ids.length;
      const order = [...ids.slice(turn), ...ids.slice(0, turn)];
      const others = env.ctx.sqlite
        .prepare<{ id: number }, []>(
          "SELECT id FROM widgets WHERE position = 'forum_list_sidebar' ORDER BY display_order, id",
        )
        .all()
        .map((row) => row.id)
        .filter((id) => !ids.includes(id));
      return env.call("widgets.reorder", env.actors.admin, {
        position: "forum_list_sidebar",
        ids: [...others, ...order],
      });
    },
  },
];
