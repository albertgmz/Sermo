import { expect, test } from "bun:test";
import { homeRedirectTarget } from "./home-redirects";

const cases = (rows: [string, string | undefined][]) => {
  for (const [from, to] of rows) {
    const url = new URL(from, "http://localhost");
    expect(homeRedirectTarget(url.pathname, url.search), from).toBe(to);
  }
};

test("a feed tab on the home page goes to the feed page with its whole query", () => {
  cases([
    ["/?tab=latest", "/whats-new?tab=latest"],
    ["/?tab=hot&cursor=abc&pages=2", "/whats-new?tab=hot&cursor=abc&pages=2"],
    ["/?tab=following", "/whats-new?tab=following"],
    ["/?tab=media&picture=post-1-2", "/whats-new?tab=media&picture=post-1-2"],
    // A tab that names none opened the visitor's default feed tab.
    ["/?tab=top", "/whats-new?tab=top"],
  ]);
});

test("the feed's own keys on the home page go to the feed page", () => {
  cases([
    ["/?cursor=abc", "/whats-new?cursor=abc"],
    ["/?pages=3", "/whats-new?pages=3"],
    ["/?picture=wall-4-5", "/whats-new?picture=wall-4-5"],
    ["/?forums=3%2C4", "/whats-new?forums=3%2C4"],
    ["/?prefix=2", "/whats-new?prefix=2"],
    ["/?type=sticky", "/whats-new?type=sticky"],
    ["/?tag=rust", "/whats-new?tag=rust"],
    ["/?watched=1&utm_source=x", "/whats-new?watched=1&utm_source=x"],
    ["/?unread=1", "/whats-new?unread=1"],
  ]);
});

test("the Forums tab is the home page itself, with its section and statistics tab", () => {
  cases([
    ["/?tab=forums", "/"],
    ["/?tab=forums&section=5&stats=threads", "/?section=5&stats=threads"],
  ]);
});

test("the old forum list goes to the home page, its tab becoming the section", () => {
  cases([
    ["/forums", "/"],
    ["/forums/", "/"],
    ["/forums?tab=5", "/?section=5"],
    ["/forums?tab=5&stats=reacted", "/?stats=reacted&section=5"],
    ["/forums?stats=members", "/?stats=members"],
  ]);
});

test("the current addresses are left alone", () => {
  cases([
    ["/", undefined],
    ["/?section=5&stats=threads", undefined],
    ["/?notice=accountDeleted", undefined],
    ["/?utm_source=x&ref=7", undefined],
    ["/whats-new", undefined],
    ["/whats-new?tab=hot", undefined],
    ["/forums/5", undefined],
    ["/forums/5-garden?tab=x", undefined],
    ["/threads/1", undefined],
  ]);
});

test("the feed's old Spanish address and everything under it go to the feed page, keeping the query", () => {
  cases([
    ["/novedades", "/whats-new"],
    ["/novedades/", "/whats-new"],
    ["/novedades?tab=hot", "/whats-new?tab=hot"],
    [
      "/novedades?tab=hot&cursor=abc&utm_source=x",
      "/whats-new?tab=hot&cursor=abc&utm_source=x",
    ],
    ["/novedades/posts/", "/whats-new"],
    ["/novedades/latest-activity?tab=media", "/whats-new?tab=media"],
    ["/novedadesx", undefined],
  ]);
});
