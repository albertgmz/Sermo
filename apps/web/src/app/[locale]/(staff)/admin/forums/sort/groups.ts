// The groups the sort page offers: the nodes of the tree (in the tree's order) by parent, leaving
// out a parent with a single child, which has nothing to be ordered against. A node's number only
// counts among the nodes with the same parent.
export function sortableGroups<Node extends { parentId: number | null }>(
  nodes: readonly Node[],
): { parentId: number | null; members: Node[] }[] {
  return [...Map.groupBy(nodes, (node) => node.parentId)]
    .filter(([, members]) => members.length > 1)
    .map(([parentId, members]) => ({ parentId, members }));
}
