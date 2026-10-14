type Node = { id: number; parentId: number | null };
type Staff = {
  moderatesEverywhere: boolean;
  moderatedNodeIds: readonly number[];
  moderatedNodesTruncated: boolean;
};

// The forums a moderation queue's forum filter may offer: all of them for someone who moderates
// everywhere, and when the backend's list of moderated forums was cut short (it cannot say which
// are missing). Otherwise only the forums they moderate, a forum under a moderated one included.
export function moderatedForums<N extends Node>(
  nodes: readonly N[],
  staff: Staff,
): N[] {
  if (staff.moderatesEverywhere || staff.moderatedNodesTruncated) {
    return [...nodes];
  }
  const moderated = new Set(staff.moderatedNodeIds);
  const parent = new Map(nodes.map((node) => [node.id, node.parentId]));
  const inside = (id: number | null): boolean => {
    for (let hops = 0; id !== null && hops < nodes.length; hops += 1) {
      if (moderated.has(id)) return true;
      id = parent.get(id) ?? null;
    }
    return false;
  };
  return nodes.filter((node) => inside(node.id));
}
