import { FORUM_PREFIX } from "@/lib/sermo/addresses";
import { parseId } from "@/lib/sermo/ids";

// Addresses of the XenForo forum this site replaced, which Google, bookmarks and imported posts
// still carry. Imported content keeps XenForo's ids, so an address is answered from its own text,
// with no lookup: `/tema/<slug>.<id>/` is the thread with that id. XenForo writes the id after a
// dot; this app writes it before a dash (`/threads/<id>-<slug>`), so a dotted address never
// collides with one of this app's own. A bare id in a prefix this app also uses
// (`/threads/5`) is this app's address and stays as it is.

type Kind = "thread" | "forum" | "member" | "post" | "conversation";

// Every name XenForo's installs used for each kind, longest prefix first. `own` marks the names
// this app serves too.
const PREFIXES: { names: string[]; kind: Kind; own: boolean }[] = [
  { names: ["foro/temas"], kind: "thread", own: false },
  { names: ["tema", "temas"], kind: "thread", own: false },
  { names: ["threads"], kind: "thread", own: true },
  { names: ["foros", "foro", "categories"], kind: "forum", own: false },
  { names: ["forums"], kind: "forum", own: true },
  { names: ["miembros"], kind: "member", own: false },
  { names: ["members"], kind: "member", own: true },
  { names: ["respuestas"], kind: "post", own: false },
  { names: ["posts"], kind: "post", own: true },
  {
    names: ["conversaciones", "direct-messages"],
    kind: "conversation",
    own: false,
  },
  { names: ["conversations"], kind: "conversation", own: true },
];

const TARGETS: Record<Exclude<Kind, "forum">, string> = {
  thread: "threads",
  member: "members",
  post: "posts",
  conversation: "conversations",
};

// Sections whose every address goes to the front page.
const HOME_SECTIONS = ["novedades", "whats-new", "find-new"];
const ACCOUNT_PAGES: Record<string, string> = {
  login: "/login",
  register: "/register",
  "lost-password": "/forgot-password",
};

// The id in `<slug>.<id>` or a bare `<id>`; null for anything else. In a name this app serves too,
// the slug must have a letter (`/conversations/1.5` is no address) and a bare id is its own.
function idIn(segment: string, own: boolean, viaIndex: boolean) {
  const dot = segment.lastIndexOf(".");
  if (dot === -1) return own && !viaIndex ? null : parseId(segment);
  if (own && !viaIndex && !/[^\d.]/.test(segment.slice(0, dot))) return null;
  return parseId(segment.slice(dot + 1));
}

function pathOf(kind: Kind, id: number) {
  return `/${kind === "forum" ? FORUM_PREFIX : TARGETS[kind]}/${id}`;
}

// The address on this site for an old XenForo one, or undefined when the address is not one.
// `search` is the query as written, with its `?`. The query is dropped, except for the pieces
// that name the page itself (`index.php?threads/x.1/`, `goto/post?id=5`).
export function xenforoTarget(pathname: string, search: string) {
  let path = pathname;
  let params = new URLSearchParams(search);
  let viaIndex = false;
  if (pathname === "/index.php") {
    viaIndex = true;
    const [route = "", ...rest] = search.slice(1).split("&");
    if (route.includes("=")) return undefined;
    path = `/${route}`;
    params = new URLSearchParams(rest.join("&"));
  } else if (pathname.startsWith("/index.php/")) {
    viaIndex = true;
    path = pathname.slice("/index.php".length);
  }
  const segments = path.split("/").filter(Boolean);
  const lowered = segments.map((part) => part.toLowerCase());
  const [first = "", second = ""] = lowered;
  if (segments.length === 0) return viaIndex ? "/" : undefined;
  if (HOME_SECTIONS.includes(first)) return "/";
  if (first === "forums" && segments.length === 1) {
    // `/forums` is this app's own list of forums.
    return viaIndex ? "/" : undefined;
  }
  if (segments.length === 1 && first in ACCOUNT_PAGES) {
    // `/login` and `/register` are this app's own addresses as well.
    const page = ACCOUNT_PAGES[first];
    return viaIndex || page !== `/${first}` ? page : undefined;
  }
  // Wall posts and their comments carry a bare id (`/profile-posts/5/`,
  // `/profile-posts/comments/9/`); fcuba.net never renamed the prefix. `/profile-posts/5` is this
  // app's own address as well, so only its sub-pages and the comment form are rewritten.
  if (first === "profile-posts") {
    const comment = second === "comments";
    const id = parseId(segments[comment ? 2 : 1] ?? "");
    if (id === null) return undefined;
    if (comment) return `/profile-comments/${id}`;
    return viaIndex || segments.length > 2 ? `/profile-posts/${id}` : undefined;
  }
  if (first === "goto" && second === "post") {
    const id = parseId(params.get("id") ?? "");
    return id === null ? undefined : pathOf("post", id);
  }
  for (const { names, kind, own } of PREFIXES) {
    const name = names.find((candidate) =>
      candidate.split("/").every((part, index) => lowered[index] === part),
    );
    if (!name) continue;
    const depth = name.split("/").length;
    const segment = segments[depth];
    if (segment === undefined) return undefined;
    // This app's own shape (`/threads/12-slug`) is never rewritten.
    if (own && !viaIndex && /^[1-9]\d*(?:-|$)/.test(segment)) return undefined;
    const id = idIn(segment, own, viaIndex);
    if (id === null) return undefined;
    if (kind === "thread") {
      const post = /^post-(\d+)$/.exec(segments[depth + 1] ?? "");
      const postId = post ? parseId(post[1]) : null;
      if (postId !== null) return pathOf("post", postId);
    }
    return pathOf(kind, id);
  }
  return undefined;
}
