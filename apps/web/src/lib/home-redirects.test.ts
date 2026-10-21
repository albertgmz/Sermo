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
    ["/?tab=latest", "/novedades?tab=latest"],
    ["/?tab=hot&cursor=abc&pages=2", "/novedades?tab=hot&cursor=abc&pages=2"],
    ["/?tab=following", "/novedades?tab=following"],
    ["/?tab=media&picture=post-1-2", "/novedades?tab=media&picture=post-1-2"],
    // A tab that names none opened the visitor's default feed tab.
    ["/?tab=top", "/novedades?tab=top"],
  ]);
});

test("the feed's own keys on the home page go to the feed page", () => {
  cases([
    ["/?cursor=abc", "/novedades?cursor=abc"],
    ["/?pages=3", "/novedades?pages=3"],
    ["/?picture=wall-4-5", "/novedades?picture=wall-4-5"],
    ["/?forums=3%2C4", "/novedades?forums=3%2C4"],
    ["/?prefix=2", "/novedades?prefix=2"],
    ["/?type=sticky", "/novedades?type=sticky"],
    ["/?tag=rust", "/novedades?tag=rust"],
    ["/?watched=1&utm_source=x", "/novedades?watched=1&utm_source=x"],
    ["/?unread=1", "/novedades?unread=1"],
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
    ["/novedades", undefined],
    ["/novedades?tab=hot", undefined],
    ["/forums/5", undefined],
    ["/forums/5-garden?tab=x", undefined],
    ["/threads/1", undefined],
  ]);
});
