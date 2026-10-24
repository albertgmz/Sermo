// What the delete dialog of an item offers the viewer: nothing (`show` false), the soft delete, the
// soft delete beside deleting for good ("choice"), or only deleting for good ("only", for an item
// that is already deleted). A display hint like `mayRestore`: the backend refuses what the viewer
// may not do. `canHardDelete` is the backend's word for the item as it is now; `hardDeleteAny` is
// holding the permission whatever the state, since staff reach a live item by hiding it first.
export function deleteMode(
  item: {
    state: "visible" | "moderated" | "deleted";
    canDelete: boolean;
    canHardDelete: boolean;
  },
  hardDeleteAny: boolean,
): { show: boolean; permanent?: "choice" | "only" } {
  const soft = item.canDelete && item.state !== "deleted";
  const hard = item.canHardDelete || (soft && hardDeleteAny);
  if (!hard) return { show: soft };
  return { show: true, permanent: soft ? "choice" : "only" };
}
