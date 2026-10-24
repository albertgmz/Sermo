import type { Scenario } from "../harness";

const choose = (values: number[], i: number) => values[i % values.length]!;
// A text with what costs the renderer most on a page: formatting, a mention, a link and a quote.
const BODY =
  "[b]Preview[/b] of a [i]benchmark[/i] post for @admin with [url=https://example.test]a link[/url].\n[quote]A quoted line.[/quote]";

// The composer's Preview (`posts.preview`): the checks of posting there, then the post's renderer,
// nothing written. A new thread's opening post, and a reply in the biggest threads.
export const scenarios: Scenario[] = [
  {
    name: "posts.preview thread",
    kind: "read",
    run: (env, i) =>
      env.call("posts.preview", env.actors.member(i), {
        target: { type: "thread", nodeId: choose(env.meta.forumIds, i) },
        body: BODY,
      }),
  },
  {
    name: "posts.preview reply huge",
    kind: "read",
    run: (env, i) =>
      env.call("posts.preview", env.actors.member(i), {
        target: { type: "reply", threadId: choose(env.meta.bigThreadIds, i) },
        body: BODY,
      }),
  },
];
