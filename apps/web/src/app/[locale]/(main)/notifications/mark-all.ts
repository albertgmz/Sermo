import type { MarkAllState } from "@/app/[locale]/(main)/notifications/actions";

// Runs the action and, once it has gone through, refreshes the route: the unread counts sit in the
// layout, which the action's answer does not redraw.
export async function markAllThenRefresh(
  markAll: (previous: MarkAllState) => Promise<MarkAllState>,
  refresh: () => void,
  previous: MarkAllState,
): Promise<MarkAllState> {
  const state = await markAll(previous);
  if (!state.error) refresh();
  return state;
}
