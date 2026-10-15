import { expect, test } from "bun:test";
import { createEditor } from "lexical";
import { $exportBb, $insertBb, BB_NODES } from "./bb-lexical";
import { type DomNode, htmlToBb } from "./html-to-bb";

// A small stand-in for the DOM a browser makes of pasted HTML.
type Kid = DomNode | string;
const text = (value: string): DomNode => ({
  nodeType: 3,
  nodeName: "#text",
  childNodes: [],
  textContent: value,
});
const comment = (): DomNode => ({
  nodeType: 8,
  nodeName: "#comment",
  childNodes: [],
  textContent: "StartFragment",
});
function h(
  name: string,
  attributes: Record<string, string>,
  ...kids: Kid[]
): DomNode {
  const childNodes = kids.map((kid) =>
    typeof kid === "string" ? text(kid) : kid,
  );
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes,
    textContent: childNodes.map((kid) => kid.textContent ?? "").join(""),
    getAttribute: (key) => attributes[key] ?? null,
  };
}
const root = (...kids: Kid[]) => h("body", {}, ...kids);

test("bold, italic, underline and strikethrough tags become their BB code", () => {
  const dom = root(
    h(
      "p",
      {},
      "a ",
      h("b", {}, "bold"),
      ", ",
      h("em", {}, "italic"),
      ", ",
      h("u", {}, "under"),
      " and ",
      h("s", {}, "gone"),
    ),
  );
  expect(htmlToBb(dom)).toBe(
    "a [B]bold[/B], [I]italic[/I], [U]under[/U] and [S]gone[/S]",
  );
});

test("a word processor's styles on a span become BB code too", () => {
  const dom = root(
    h("span", { style: "font-weight:700; font-style:italic" }, "both"),
    " ",
    h("span", { style: "text-decoration: underline line-through" }, "lines"),
    " ",
    h("span", { style: "font-weight:400" }, "plain"),
  );
  expect(htmlToBb(dom)).toBe("[B][I]both[/I][/B] [U][S]lines[/S][/U] plain");
});

test("a page wrapper that only says its text is not bold does not make it bold", () => {
  const dom = root(
    comment(),
    h(
      "b",
      { style: "font-weight:normal" },
      h("p", {}, "one"),
      h("p", {}, h("span", { style: "font-weight:bold" }, "two")),
    ),
  );
  expect(htmlToBb(dom)).toBe("one\n\n[B]two[/B]");
});

test("links keep their address when it is http(s), and are text otherwise", () => {
  const dom = root(
    h("a", { href: "https://example.com/a?b=1" }, "web"),
    ", ",
    h("a", { href: "/forums/1" }, "site"),
    ", ",
    h("a", { href: "javascript:alert(1)" }, "script"),
    ", ",
    h("a", { href: "mailto:a@b.co" }, "mail"),
    ", ",
    h("a", { href: "#top" }, "anchor"),
    ", ",
    h("a", { href: "https://a.test/x y" }, "spaced"),
  );
  expect(htmlToBb(dom)).toBe(
    "[URL=https://example.com/a?b=1]web[/URL], site, script, mail, anchor, spaced",
  );
});

test("a link inside a link is only text", () => {
  const dom = root(
    h(
      "a",
      { href: "https://a.test" },
      "outer ",
      h("a", { href: "https://b.test" }, "inner"),
    ),
  );
  expect(htmlToBb(dom)).toBe("[URL=https://a.test]outer inner[/URL]");
});

test("pictures are [IMG] only when their address is http(s)", () => {
  const dom = root(
    h("img", { src: "https://pics.test/a.png", alt: "x" }),
    h("img", { src: "data:image/png;base64,AAAA" }),
    h("img", { src: "javascript:alert(1)" }),
    h("img", { src: "/local.png" }),
    h("img", {}),
  );
  expect(htmlToBb(dom)).toBe("[IMG]https://pics.test/a.png[/IMG]");
});

test("lists, nested lists, quotes, headings and code blocks", () => {
  const dom = root(
    h("h1", {}, "Title"),
    h("h5", {}, "Small ", h("b", {}, "head")),
    h("p", {}, "Intro"),
    h(
      "ul",
      {},
      h("li", {}, "one", h("ol", {}, h("li", {}, "inner"))),
      h("li", {}, h("p", {}, "two")),
    ),
    h("blockquote", {}, h("p", {}, "quoted"), h("p", {}, "twice")),
    h("pre", {}, h("code", {}, "let a = 1;\n\n\nlet b = 2;\n")),
  );
  expect(htmlToBb(dom)).toBe(
    [
      "[HEADING=1]Title[/HEADING]",
      "[HEADING=3]Small [B]head[/B][/HEADING]",
      "Intro",
      "[LIST]\n[*]one\n[LIST=1]\n[*]inner\n[/LIST]\n[*]two\n[/LIST]",
      "[QUOTE]quoted\n\ntwice[/QUOTE]",
      "[CODE]\nlet a = 1;\n\n\nlet b = 2;\n[/CODE]",
    ].join("\n\n"),
  );
});

test("inline code, tables, colours and everything else are their text", () => {
  const dom = root(
    h(
      "p",
      {},
      "use ",
      h("code", {}, "npm i"),
      " now ",
      h("span", { style: "color:red;font-size:30px" }, "red"),
    ),
    h(
      "table",
      {},
      h("tr", {}, h("td", {}, "a"), h("td", {}, "b")),
      h("tr", {}, h("td", {}, "c"), h("td", {}, "d")),
    ),
    h("script", {}, "alert(1)"),
    h("style", {}, "p {}"),
    h("iframe", { src: "https://x.test" }, "frame"),
  );
  expect(htmlToBb(dom)).toBe("use [ICODE]npm i[/ICODE] now red\n\na b\nc d");
});

test("line breaks stay line breaks and a div is a line", () => {
  const dom = root(
    h("div", {}, "one", h("br", {}), "two"),
    h("div", {}, "three"),
    h("p", {}, "four"),
  );
  expect(htmlToBb(dom)).toBe("one\ntwo\nthree\n\nfour");
});

test("text that looks like a BB code tag stays text", () => {
  const dom = root(h("p", {}, "type [b]bold[/b] to"), h("p", {}, "arr[i] = 1"));
  expect(htmlToBb(dom)).toBe(
    "[PLAIN]type [b]bold[/b] to[/PLAIN]\n\narr[i] = 1",
  );
});

test("empty formatting adds no tags", () => {
  const dom = root(h("b", {}, " "), h("i", {}), h("p", {}, "x"));
  expect(htmlToBb(dom)).toBe("x");
});

test("a long page is read in a short time", () => {
  const kids: Kid[] = [];
  for (let i = 0; i < 4000; i++)
    kids.push(h("p", {}, `line ${i} `, h("b", {}, "bold"), h("br", {})));
  const start = performance.now();
  const out = htmlToBb(root(...kids));
  expect(performance.now() - start).toBeLessThan(500);
  expect(out.startsWith("line 0 [B]bold[/B]\n\nline 1")).toBe(true);
});

// What reaches the editor when it is pasted.
function pasted(dom: DomNode) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
  let out = "";
  editor.update(
    () => {
      $insertBb(htmlToBb(dom));
      out = $exportBb();
    },
    { discrete: true },
  );
  return out;
}

test("pasted rich text reaches the editor and is sent as the same BB code", () => {
  const dom = root(
    h("h2", {}, "Head"),
    h(
      "p",
      {},
      "a ",
      h("b", {}, "bold"),
      " ",
      h("a", { href: "https://a.test" }, "link"),
    ),
    h("ul", {}, h("li", {}, "x"), h("li", {}, "y")),
  );
  expect(pasted(dom)).toBe(
    "[HEADING=2]Head[/HEADING]\n\na [B]bold[/B] [URL=https://a.test]link[/URL]\n\n[LIST]\n[*]x\n[*]y\n[/LIST]",
  );
});

test("a page's underlined link is a link, not underlined text", () => {
  const dom = root(
    h(
      "a",
      { href: "https://a.test", style: "text-decoration: underline" },
      "link",
    ),
  );
  expect(htmlToBb(dom)).toBe("[URL=https://a.test]link[/URL]");
});

test("the space around a link stays outside its tags and inside its text", () => {
  const dom = root("see", h("a", { href: "https://a.test" }, " here"), " now");
  expect(htmlToBb(dom)).toBe("see[URL=https://a.test] here[/URL] now");
});

test("a code block, and a block whose style keeps its spaces, keep their indentation and breaks", () => {
  const dom = root(
    h(
      "pre",
      {},
      "function f() {",
      h("br", {}),
      "  return 1;",
      h("br", {}),
      "}",
    ),
    h(
      "div",
      { style: "white-space: pre" },
      "    indented",
      h("br", {}),
      "  less",
    ),
  );
  expect(htmlToBb(dom)).toBe(
    "[CODE]\nfunction f() {\n  return 1;\n}\n[/CODE]\n\n[CODE]\n    indented\n  less\n[/CODE]",
  );
});

test("code that holds a BB code tag stays text", () => {
  const dom = root(
    h("pre", {}, "[B]x[/B]\n[/CODE]"),
    h("p", {}, "[/plain][IMG]https://t.test/x.png[/IMG] [/b]"),
  );
  const out = htmlToBb(dom);
  expect(out).toBe(
    "[PLAIN][B]x[/B]\n[/CODE][/PLAIN]\n\n[PLAIN][/\u200bplain][IMG]https://t.test/x.png[/IMG] [/b][/PLAIN]",
  );
});

test("a mark said by many nested elements is written once, and deep nesting stays shallow", () => {
  let dom: DomNode = h("b", {}, "x");
  for (let i = 0; i < 500; i++) dom = h("b", {}, dom);
  expect(htmlToBb(root(dom))).toBe("[B]x[/B]");
  const mixed = h(
    "b",
    {},
    h("strong", { style: "font-weight:bold" }, "y"),
    h("i", {}, " z"),
  );
  expect(htmlToBb(root(mixed))).toBe("[B]y [I]z[/I][/B]");
});

test("a list, heading, quote or code block inside a format is not wrapped in it", () => {
  const dom = root(
    h("b", {}, h("ul", {}, h("li", {}, "x"))),
    h("i", {}, h("h2", {}, "head")),
    h("b", {}, h("pre", {}, "code")),
  );
  expect(htmlToBb(dom)).toBe(
    "[LIST]\n[*]x\n[/LIST]\n\n[HEADING=2]head[/HEADING]\n\n[CODE]\ncode\n[/CODE]",
  );
});

test("text that would open a tag which reads what follows it as text stays text", () => {
  const dom = root(
    h("p", {}, "use [code] tags"),
    h("pre", {}, "x = 1"),
    h("ul", {}, h("li", {}, "a [*] b")),
  );
  expect(htmlToBb(dom)).toBe(
    "[PLAIN]use [code] tags[/PLAIN]\n\n[CODE]\nx = 1\n[/CODE]\n\n[LIST]\n[*][PLAIN]a [*] b[/PLAIN]\n[/LIST]",
  );
});

test("a style that says important is read, and long runs of odd spaces are read in a short time", () => {
  expect(
    htmlToBb(root(h("span", { style: "font-weight: bold !important" }, "x"))),
  ).toBe("[B]x[/B]");
  const start = performance.now();
  htmlToBb(root(h("b", {}, `a${"　".repeat(20000)}b`)));
  expect(performance.now() - start).toBeLessThan(100);
});

test("a closing tag split between elements stays text", () => {
  const dom = root(
    h("p", {}, h("b", {}, "x")),
    h("p", {}, h("span", {}, "[/"), h("span", {}, "B]"), " tail"),
    h("p", {}, h("i", {}, "[/"), "b]"),
  );
  const out = htmlToBb(dom);
  expect(out).toContain("[PLAIN][/[/PLAIN]B]");
  expect(out).toContain("[B]x[/B]");
  // The tags the page wrote are the only live ones.
  expect(out).toBe(
    "[B]x[/B]\n\n[PLAIN][/[/PLAIN]B] tail\n\n[I][PLAIN][/[/PLAIN][/I]b]",
  );
});

test("a picture that is not on the web is its alt text", () => {
  const dom = root(
    h(
      "p",
      {},
      "see ",
      h("img", { src: "data:image/png;base64,AA", alt: "a cat" }),
      " and ",
      h("img", { src: "//x.test/a.png", alt: "" }),
    ),
  );
  expect(htmlToBb(dom)).toBe("see a cat and");
});

test("text that opens tags over and over is read in a short time", () => {
  for (const unit of ["[url", "[img x", "[code ", "[plain", "[/"]) {
    const start = performance.now();
    htmlToBb(root(h("p", {}, unit.repeat(40000))));
    expect(performance.now() - start, unit).toBeLessThan(400);
  }
});
