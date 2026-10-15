import { threadsFeatured } from "../../contracts/feed";
import { implement } from "../../operation";
import { iso, isoOrNull } from "../../time";
import { threadRowsByIds, threadValuesFor } from "../forums";
import { activeFeatures, type FeatureRow } from "../forums/features";
import { firstSurvivors } from "./rankings";
import { ignoredAmong, visibleNodes } from "./viewer";

/**
 * The threads featured right now that the viewer may open, newest feature first. The same rules
 * as the hot feed: a forum the viewer cannot open, a thread that is not visible (deleted,
 * awaiting approval, merged away) and a thread of a member the viewer ignores are left out. A
 * thread with a staff pick and a paid promotion is listed once, as its staff pick.
 */
export const threadsFeaturedOp = implement(threadsFeatured, (ctx, actor, input) => {
  const nodes = visibleNodes(ctx, actor);
  const byThread = new Map<number, FeatureRow>();
  for (const feature of activeFeatures(ctx, ctx.now())) {
    const held = byThread.get(feature.thread_id);
    if (!held || (feature.kind === "staff" && held.kind !== "staff"))
      byThread.set(feature.thread_id, feature);
  }
  const shown = firstSurvivors([...byThread.values()], input.limit, (chunk) => {
    const threads = new Map(
      threadRowsByIds(
        ctx,
        chunk.map((feature) => feature.thread_id),
      ).map((thread) => [thread.id, thread]),
    );
    const ignored = ignoredAmong(
      ctx,
      actor,
      [...threads.values()].map((thread) => thread.user_id),
    );
    return chunk.flatMap((feature) => {
      const thread = threads.get(feature.thread_id);
      return thread &&
        thread.state === "visible" &&
        thread.merged_into_id === null &&
        nodes.has(thread.node_id) &&
        !ignored.has(thread.user_id)
        ? [{ feature, thread }]
        : [];
    });
  });
  const values = threadValuesFor(
    ctx,
    actor,
    shown.map((entry) => entry.thread),
  );
  return {
    items: shown.map(({ feature }, index) => ({
      kind: feature.kind,
      startedAt: iso(feature.started_at),
      endsAt: isoOrNull(feature.ends_at),
      thread: values[index]!,
    })),
  };
});
