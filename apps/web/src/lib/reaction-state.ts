import type { ReactionType } from "@/components/forum/reaction-button";
import type { ReactionsSummary } from "@/components/forum/reaction-summary";

// The summary of an item with the viewer's own reaction changed from `drawn` (what the summary was
// drawn with) to `mine`: their old reaction leaves the counts and the new one joins them. The new
// reaction's type comes from `offered`, the types the picker holds.
export function withViewerReaction(
  summary: ReactionsSummary,
  drawn: number | null,
  mine: number | null,
  offered: ReactionType[],
): ReactionsSummary {
  if (drawn === mine) return summary;
  const counts = new Map(
    summary.byType.map(({ type, count }) => [type, count]),
  );
  const typeOf = (id: number) =>
    [...counts.keys()].find((type) => type.id === id) ??
    offered.find((type) => type.id === id);
  if (drawn !== null) {
    const type = typeOf(drawn);
    if (type) counts.set(type, (counts.get(type) ?? 0) - 1);
  }
  if (mine !== null) {
    const type = typeOf(mine);
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return {
    total: summary.total - Number(drawn !== null) + Number(mine !== null),
    byType: [...counts]
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }))
      .toSorted((a, b) => b.count - a.count),
  };
}
