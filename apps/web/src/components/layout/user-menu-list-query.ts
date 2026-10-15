import { keepPreviousData } from "@tanstack/react-query";

// The lists that are asked for when their tab opens, and the key each is held under. The count is
// part of the key: a new unread count asks for the list again, and the rows of the last count stay
// up until the new ones arrive.
export type ListKind = "alerts" | "conversations" | "bookmarks";

export const listKey = (kind: ListKind, count: number) =>
  ["user-menu", kind, count] as const;

// How a list is asked for: when its tab mounts (never before), always fresh, held only while a tab
// shows it (the rows belong to the member who opened it). Rendered rows are not plain data, so the
// answer is not compared with the last one.
export function listQuery(
  kind: ListKind,
  count: number,
  load: () => Promise<React.ReactNode>,
) {
  return {
    queryKey: listKey(kind, count),
    queryFn: load,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
    placeholderData: keepPreviousData,
  };
}
