import type * as z from "zod";
import { type Ctx, cached } from "../../context";
import type { ThreadPrefix, ThreadPrefixTag } from "../../contracts/forums";
import { getNodeTree } from "../../permissions";
import { iso } from "../../time";
import { catalogs } from "../appearance/store";

export type PrefixTag = z.infer<typeof ThreadPrefixTag>;
type PrefixValue = z.infer<typeof ThreadPrefix>;

export interface PrefixRow {
  id: number;
  label: string;
  color_id: number;
  icon: string;
  position: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

/** Every prefix, in display order. Rebuilt when the `thread_prefixes` cache version moves. */
export function prefixRows(ctx: Ctx): readonly PrefixRow[] {
  return cached(ctx, "thread_prefixes", () =>
    ctx.sqlite.prepare<PrefixRow, []>("SELECT * FROM thread_prefixes ORDER BY position, id").all(),
  );
}

/**
 * What a page of threads shows besides their own columns: the forum, the prefix and the cover.
 * Built once per page from caches, so no thread costs a query. Inactive prefixes and catalog
 * entries still show on the threads that carry them.
 */
export interface ThreadPresenter {
  node(id: number): { id: number; title: string };
  prefix(id: number | null): PrefixTag | null;
  cover(id: number | null): { fileId: number; url: string } | null;
}

export function threadPresenter(ctx: Ctx): ThreadPresenter {
  const tree = getNodeTree(ctx);
  const lists = catalogs(ctx);
  const prefixes = new Map(prefixRows(ctx).map((row) => [row.id, row]));
  return {
    node(id) {
      const entry = tree.get(id);
      return { id, title: entry?.title ?? "" };
    },
    prefix(id) {
      const row = id === null ? undefined : prefixes.get(id);
      return row ? prefixTag(row, lists.colorById.get(row.color_id)?.color ?? "") : null;
    },
    cover(id) {
      return id === null ? null : (lists.imageById.get(id)?.image ?? null);
    },
  };
}

function prefixTag(row: PrefixRow, color: string): PrefixTag {
  return { id: row.id, label: row.label, color, icon: row.icon };
}

export function prefixValue(ctx: Ctx, row: PrefixRow): PrefixValue {
  const color = catalogs(ctx).colorById.get(row.color_id)?.color ?? "";
  return {
    ...prefixTag(row, color),
    colorId: row.color_id,
    position: row.position,
    isActive: !!row.is_active,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * The forum list tab of every node: its root category's `tab_id`. Rebuilt with the node tree
 * (both keys are invalidated together).
 */
export function nodeTabs(ctx: Ctx): ReadonlyMap<number, number> {
  return cached(ctx, "node_tabs", () => {
    const tabbed = new Map(
      ctx.sqlite
        .prepare<{ id: number; tab_id: number }, []>(
          "SELECT id, tab_id FROM nodes WHERE tab_id IS NOT NULL AND parent_id IS NULL",
        )
        .all()
        .map((row) => [row.id, row.tab_id] as const),
    );
    const result = new Map<number, number>();
    if (tabbed.size === 0) return result;
    const tree = getNodeTree(ctx);
    for (const entry of tree.entries) {
      const rootId = tree.ancestors(entry.id)[0]?.id ?? entry.id;
      const tab = tabbed.get(rootId);
      if (tab !== undefined) result.set(entry.id, tab);
    }
    return result;
  });
}
