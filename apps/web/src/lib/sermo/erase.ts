import { SermoError } from "@/lib/sermo/errors";

// Deleting for good, which the backend allows for an item that is already deleted. A staff member
// who chose it in the delete dialog for a live item is refused with a conflict; `hide` then says
// whether hiding the item first is the remedy (and does it), and the deletion is tried again. Any
// other refusal, and a conflict that hiding does not cure, is the answer.
export async function eraseHidingFirst<T>(
  erase: () => Promise<T>,
  hide: () => Promise<boolean>,
): Promise<T> {
  try {
    return await erase();
  } catch (error) {
    if (!(error instanceof SermoError) || error.code !== "conflict")
      throw error;
    if (!(await hide())) throw error;
    return erase();
  }
}
