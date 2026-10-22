"use server";

import { getSmilies } from "@/lib/sermo/smilies";

// The site's smilies, for the composers' emoji picker and ":" list.
export async function listSmilies() {
  return getSmilies();
}
