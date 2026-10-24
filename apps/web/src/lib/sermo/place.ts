import { parsePageId } from "./ids";

// The page a request renders, as the backend notes it for who is online (`PLACE_HEADER`): a kind
// and, for a forum, a thread or a member, its id. Never the address itself: no slug, no query,
// nothing of a direct message. Any page not named here is `page`.
const BARE: Record<string, string> = {
  "": "forumList",
  novedades: "latest",
  online: "online",
  conversations: "conversations",
  search: "search",
};
const TARGETED: Record<string, string> = {
  forums: "forum",
  threads: "thread",
  members: "member",
};

export function placeOfPath(path: string | null): string | null {
  if (path === null) return null;
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  const [section = "", id] = pathname.split("/").slice(1);
  if (
    section === "members" &&
    (id === undefined || id === "" || id === "month")
  )
    return "members";
  const kind = TARGETED[section];
  if (kind) {
    const number = id === undefined ? null : parsePageId(id);
    return number === null ? "page" : `${kind}:${number}`;
  }
  return BARE[section] ?? "page";
}
