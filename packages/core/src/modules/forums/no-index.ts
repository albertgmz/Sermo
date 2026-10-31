import { type Ctx, prepared } from "../../context";
import { getNodeTree } from "../../permissions";

/**
 * The nodes kept from search engines: those an administrator flagged "Do not index" and every
 * node under them. One lookup for the whole call, so a scan reads the set once and tests each row
 * against it.
 */
export function noIndexNodeIds(ctx: Ctx): ReadonlySet<number> {
  const flagged = prepared(ctx, "forums.noIndexNodes", () =>
    ctx.sqlite.prepare<{ id: number }, []>("SELECT id FROM nodes WHERE no_index = 1"),
  ).all();
  const tree = getNodeTree(ctx);
  return new Set(flagged.flatMap((row) => tree.subtreeIds(row.id)));
}
