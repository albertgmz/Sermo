import { type Ctx, cached } from "../context";

export interface NodeTreeEntry {
  id: number;
  parentId: number | null;
  type: "category" | "forum";
  title: string;
  description: string;
  position: number;
  depth: number;
}
export interface NodeTree {
  /** Depth-first, parents before children, siblings by position. */
  readonly entries: readonly NodeTreeEntry[];
  get(id: number): NodeTreeEntry | undefined;
  ancestors(id: number): readonly NodeTreeEntry[];
  subtreeIds(id: number): readonly number[];
}

export function getNodeTree(ctx: Ctx): NodeTree {
  return cached(ctx, "node_tree", () => {
    const rows = ctx.sqlite
      .prepare<Omit<NodeTreeEntry, "depth">, []>(
        "SELECT id, parent_id AS parentId, type, title, description, position FROM nodes ORDER BY position, id",
      )
      .all();
    const children = new Map<number | null, typeof rows>();
    for (const row of rows) {
      const list = children.get(row.parentId) ?? [];
      list.push(row);
      children.set(row.parentId, list);
    }
    const entries: NodeTreeEntry[] = [];
    const byId = new Map<number, NodeTreeEntry>();
    const walk = (parent: number | null, depth: number) => {
      for (const row of children.get(parent) ?? []) {
        const entry = { ...row, depth };
        entries.push(entry);
        byId.set(entry.id, entry);
        walk(entry.id, depth + 1);
      }
    };
    walk(null, 0);
    return {
      entries,
      get: (id: number) => byId.get(id),
      ancestors(id: number) {
        const result: NodeTreeEntry[] = [];
        let parent = byId.get(id)?.parentId;
        while (parent != null) {
          const entry = byId.get(parent);
          if (!entry) break;
          result.unshift(entry);
          parent = entry.parentId;
        }
        return result;
      },
      subtreeIds(id: number) {
        if (!byId.has(id)) return [];
        const result: number[] = [];
        const visit = (nodeId: number) => {
          result.push(nodeId);
          for (const child of children.get(nodeId) ?? []) visit(child.id);
        };
        visit(id);
        return result;
      },
    };
  });
}
