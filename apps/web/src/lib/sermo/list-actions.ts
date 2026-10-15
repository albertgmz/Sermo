import type { ListPage } from "@/lib/list-pages";
import { SermoError } from "@/lib/sermo/errors";

// What the backend says when the cursor of a later page can no longer be followed (a deleted
// record, a cursor it refuses) or the session ended while the visitor scrolled.
const ENDS_THE_LIST = ["not_found", "unauthenticated", "validation"];

export function endsTheList(code: string) {
  return ENDS_THE_LIST.includes(code);
}

// A page of a list asked for by an action, as the visitor scrolls. A stale cursor or a session that
// is gone ends the list with an empty last page: the screen is not turned into a 404 or a sign-in
// page in the middle of a scroll, and a reload says what is the matter. Any other failure (the
// backend down, a rate limit) is raised, and the list offers to try again.
export async function endQuietly(
  load: () => Promise<ListPage>,
): Promise<ListPage> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof SermoError && endsTheList(error.code)) {
      return { rows: [], nextCursor: null };
    }
    throw error;
  }
}
