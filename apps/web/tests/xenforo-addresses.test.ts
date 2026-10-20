import { expect, test } from "bun:test";
import { POSTS_PER_PAGE } from "../src/lib/sermo/page-sizes";
import { xenforoTarget } from "../src/lib/sermo/xenforo-addresses";

// The page of this site that holds the first post of the old forum's page `n` (40 posts each).
const page = (n: number) => Math.floor(((n - 1) * 40) / POSTS_PER_PAGE) + 1;

// Splits "/path?query" the way a request does.
function target(address: string) {
  const url = new URL(address, "http://localhost");
  return xenforoTarget(url.pathname, url.search);
}

function cases(table: [string, string | undefined][]) {
  for (const [from, to] of table) expect(target(from), from).toBe(to);
}

test("every thread prefix goes to the thread, with or without the slash, a slug or sub-pages", () => {
  const prefixes = ["tema", "temas", "threads", "foro/temas"];
  for (const prefix of prefixes) {
    cases([
      [`/${prefix}/mi-tema.123/`, "/threads/123"],
      [`/${prefix}/mi-tema.123`, "/threads/123"],
      [`/${prefix}/mi-tema.123/page-4`, `/threads/123?page=${page(4)}`],
      [`/${prefix}/mi-tema.123/page-1`, "/threads/123"],
      [`/${prefix}/mi-tema.123/unread`, "/threads/123/unread"],
      [`/${prefix}/mi-tema.123/latest?x=1`, "/threads/123/latest"],
      [`/${prefix}/mi-tema.123/reply`, "/threads/123"],
      [`/${prefix}/mi-tema.123/watch`, "/threads/123"],
      [`/${prefix}/mi-tema.123/post-77`, "/posts/77"],
      [`/${prefix}/mi-tema.123/post-77/`, "/posts/77"],
    ]);
  }
  cases([
    ["/tema/123/", "/threads/123"],
    ["/temas/123", "/threads/123"],
    ["/foro/temas/123/page-2", `/threads/123?page=${page(2)}`],
    ["/tema/123/post-9", "/posts/9"],
    ["/tema/a.b.123/", "/threads/123"],
    ["/tema/Mi-Tema.123/", "/threads/123"],
    ["/Tema/mi-tema.123/", "/threads/123"],
  ]);
});

test("the index.php form is read like the path form", () => {
  cases([
    ["/index.php?threads/mi-tema.123/", "/threads/123"],
    ["/index.php?threads/123/", "/threads/123"],
    ["/index.php?tema/123", "/threads/123"],
    [
      "/index.php?threads/mi-tema.123/page-2&x=1",
      `/threads/123?page=${page(2)}`,
    ],
    ["/index.php?threads/mi-tema.123/post-8", "/posts/8"],
    ["/index.php?posts/8/", "/posts/8"],
    ["/index.php?members/5/", "/members/5"],
    ["/index.php?forums/politica.4/", "/forums/4"],
    ["/index.php?forums/4/", "/forums/4"],
    ["/index.php?conversations/7/", "/conversations/7"],
    ["/index.php?goto/post&id=31", "/posts/31"],
    ["/index.php?forums/", "/"],
    ["/index.php?whats-new/", "/"],
    ["/index.php?login/", "/login"],
    ["/index.php?register/", "/register"],
    ["/index.php?lost-password/", "/forgot-password"],
    ["/index.php/threads/mi-tema.123/", "/threads/123"],
    ["/index.php", "/"],
    ["/index.php/", "/"],
  ]);
});

test("the index.php form is read as the server hands it to the proxy, its route percent-encoded", () => {
  cases([
    ["/index.php?threads%2Fmi-tema.5721%2F=", "/threads/5721"],
    ["/index.php?threads%2Fmi-tema.123%2Fpost-8=", "/posts/8"],
    ["/index.php?goto%2Fpost=&id=31", "/posts/31"],
    ["/index.php?profile-posts%2F12%2F=", "/profile-posts/12"],
    ["/index.php?conversations%2Freplies%2F9%2F=", "/conversations/messages/9"],
    ["/index.php?id=5", undefined],
  ]);
});

test("posts, with the actions XenForo has on them", () => {
  for (const prefix of ["respuestas"]) {
    cases([
      [`/${prefix}/9/react`, "/posts/9"],
      [`/${prefix}/9/report/`, "/posts/9"],
      [`/${prefix}/9/edit`, "/posts/9"],
      [`/${prefix}/9/quote`, "/posts/9"],
      [`/${prefix}/9/share`, "/posts/9"],
    ]);
  }
  cases([
    ["/respuestas/9/", "/posts/9"],
    ["/respuestas/9", "/posts/9"],
    ["/respuestas/algo.9/", "/posts/9"],
    ["/posts/algo.9/", "/posts/9"],
    ["/goto/post?id=9", "/posts/9"],
    ["/goto/post/?id=9&x=2", "/posts/9"],
    ["/goto/post", undefined],
    ["/goto/post?id=x", undefined],
  ]);
});

test("forums and categories go to the forum page by id, and a name alone is left", () => {
  for (const prefix of ["foros", "foro", "forums", "categories"]) {
    cases([
      [`/${prefix}/politica.4/`, "/forums/4"],
      [`/${prefix}/politica.4`, "/forums/4"],
      [`/${prefix}/politica.4/page-3`, "/forums/4"],
    ]);
  }
  cases([
    ["/foros/4/", "/forums/4"],
    ["/foro/4", "/forums/4"],
    ["/categories/4/", "/forums/4"],
    ["/foros/politica/", undefined],
    ["/foro/politica", undefined],
    ["/categories/politica/", undefined],
  ]);
});

test("members and conversations go to their pages", () => {
  for (const prefix of ["miembros", "members"]) {
    cases([
      [`/${prefix}/ana-perez.55/`, "/members/55"],
      [`/${prefix}/ana-perez.55`, "/members/55"],
      [`/${prefix}/ana-perez.55/recent-content`, "/members/55"],
      [`/${prefix}/ana-perez.55/about/`, "/members/55"],
    ]);
  }
  for (const prefix of ["conversaciones", "conversations", "direct-messages"]) {
    cases([
      [`/${prefix}/asunto.8/`, "/conversations/8"],
      [`/${prefix}/asunto.8`, "/conversations/8"],
      [`/${prefix}/asunto.8/page-2`, "/conversations/8"],
    ]);
  }
  for (const prefix of ["conversaciones", "direct-messages"]) {
    cases([
      [`/${prefix}/`, "/conversations"],
      [`/${prefix}`, "/conversations"],
      [`/${prefix}/add`, "/conversations/new"],
      [`/${prefix}/add?to=ana`, "/conversations/new?to=ana"],
      [`/${prefix}/add?to=ana%20p&x=1`, "/conversations/new?to=ana+p"],
      [`/${prefix}/replies/9/`, "/conversations/messages/9"],
      [`/${prefix}/messages/9`, "/conversations/messages/9"],
      [`/${prefix}/replies/x/`, undefined],
      [`/${prefix}/asunto.8/unread`, "/conversations/8/unread"],
      [`/${prefix}/asunto.8/latest`, "/conversations/8"],
    ]);
  }
  cases([
    ["/index.php?conversaciones/replies/9/", "/conversations/messages/9"],
    ["/index.php?conversations/replies/9/", "/conversations/messages/9"],
    ["/conversations/replies/9", undefined],
    ["/miembros/55/", "/members/55"],
    ["/conversaciones/8", "/conversations/8"],
    ["/direct-messages/8/", "/conversations/8"],
  ]);
});

test("wall posts and their comments go to their own addresses", () => {
  cases([
    ["/profile-posts/12/", undefined],
    ["/profile-posts/12", undefined],
    ["/profile-posts/12/show", "/profile-posts/12"],
    ["/profile-posts/12/react?reaction_id=1", "/profile-posts/12"],
    ["/profile-posts/comments/80/", "/profile-comments/80"],
    ["/profile-posts/comments/80", "/profile-comments/80"],
    ["/profile-posts/comments/80/edit", "/profile-comments/80"],
    ["/index.php?profile-posts/12/", "/profile-posts/12"],
    ["/index.php?profile-posts/comments/80/", "/profile-comments/80"],
    ["/index.php/profile-posts/12/", "/profile-posts/12"],
    ["/profile-posts/", undefined],
    ["/profile-posts/comments/", undefined],
    ["/profile-posts/x.12/", undefined],
    ["/profile-posts/comments/0/", undefined],
  ]);
});

test("the news pages go to the front page and the account pages to theirs", () => {
  cases([
    ["/novedades/", "/"],
    ["/novedades/posts/", "/"],
    ["/whats-new/latest-activity", "/"],
    ["/find-new/threads", "/"],
    ["/lost-password/", "/forgot-password"],
  ]);
});

test("this site's own addresses and unknown ones are not redirected", () => {
  cases([
    ["/", undefined],
    ["/threads/123", undefined],
    ["/threads/123-slug", undefined],
    ["/threads/123-slug?page=2", undefined],
    ["/threads/123/edit/4", undefined],
    ["/members/5", undefined],
    ["/members/5-ana", undefined],
    ["/forums", undefined],
    ["/forums/3-x", undefined],
    ["/forums/3", undefined],
    ["/forums/3/new", undefined],
    ["/posts/9", undefined],
    ["/posts/9/react", undefined],
    ["/conversations/1.5", undefined],
    ["/threads/1.5", undefined],
    ["/conversations", undefined],
    ["/conversations/5", undefined],
    ["/conversations/5/edit/7", undefined],
    ["/conversations/new", undefined],
    ["/tags/humor", undefined],
    ["/search?q=x", undefined],
    ["/account/security", undefined],
    ["/login", undefined],
    ["/login/", undefined],
    ["/register", undefined],
    ["/register/", undefined],
    ["/login/other", undefined],
    ["/pages/terms", undefined],
    ["/tema", undefined],
    ["/tema/sin-id/", undefined],
    ["/tema/mi-tema.0/", undefined],
    ["/tema/mi-tema.1e2/", undefined],
    ["/threadsx/mi-tema.123", undefined],
    ["/index.php?id=5", undefined],
    ["/respuestas/", undefined],
    ["/nodes/3", undefined],
  ]);
});
