import { type Ctx, cached } from "../context";

export interface NodeTreeEntry {
  id: number;
  parentId: number | null;
  type: "category" | "forum";
  title: string;
  description: string;
  position: number;
  depth: number;
  /** Marked +18, by itself or by a parent node. */
  adult: boolean;
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
    // The whole row, so the tree also builds on a database migrated only part of the way: the
    // upgrade tests check permissions between migrations, where a node has no +18 mark yet. A
    // column list will do again once those tests run on fully migrated databases.
    const rows = ctx.sqlite
      .prepare<
        Omit<NodeTreeEntry, "depth" | "adult" | "parentId"> & {
          parent_id: number | null;
          is_adult?: number;
        },
        []
      >("SELECT * FROM nodes ORDER BY position, id")
      .all()
      .map(({ id, parent_id, type, title, description, position, is_adult }) => ({
        id,
        parentId: parent_id,
        type,
        title,
        description,
        position,
        isAdult: is_adult ?? 0,
      }));
    const children = new Map<number | null, typeof rows>();
    for (const row of rows) {
      const list = children.get(row.parentId) ?? [];
      list.push(row);
      children.set(row.parentId, list);
    }
    const entries: NodeTreeEntry[] = [];
    const byId = new Map<number, NodeTreeEntry>();
    const walk = (parent: number | null, depth: number, parentAdult: boolean) => {
      for (const { isAdult, ...row } of children.get(parent) ?? []) {
        const entry = { ...row, depth, adult: parentAdult || isAdult === 1 };
        entries.push(entry);
        byId.set(entry.id, entry);
        walk(entry.id, depth + 1, entry.adult);
      }
    };
    walk(null, 0, false);
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
