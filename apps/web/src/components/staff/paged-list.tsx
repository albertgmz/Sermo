import { ItemList } from "./item-list";

// PagedList: the list pattern (`ItemList`) for a read the backend pages by cursor and filters on its
// side, as the members, the bans and the moderation queues do. The filter form (a GET form, so the
// address holds the choice) sits in a card above the rows; the paging links are in the list's
// footer.
//
// Props: those of `ItemList` (with its `paging`), without its `filter` box, and
//   filters  Optional filter form.
export function PagedList({
  filters,
  ...list
}: Omit<React.ComponentProps<typeof ItemList>, "filter"> & {
  filters?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {filters && (
        <div className="rounded-lg border bg-card p-4">{filters}</div>
      )}
      <ItemList {...list} />
    </div>
  );
}
