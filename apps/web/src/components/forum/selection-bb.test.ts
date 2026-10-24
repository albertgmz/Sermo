import { expect, test } from "bun:test";
import {
  bbOf,
  partialQuote,
  quotable,
  selectedBody,
} from "@/components/forum/selection-bb";

// A page as far as the selection code reads it: nodes with a parent, attributes and `closest`.
type Fake = {
  nodeType: number;
  nodeName: string;
  textContent: string;
  childNodes: Fake[];
  parentElement: Fake | null;
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
  closest(selector: string): Fake | null;
};

function node(
  nodeName: string,
  attrs: Record<string, string>,
  children: (Fake | string)[],
): Fake {
  const self: Fake = {
    nodeType: 1,
    nodeName,
    textContent: "",
    childNodes: [],
    parentElement: null,
    attrs,
    getAttribute: (name) => attrs[name] ?? null,
    closest(selector) {
      const matches = (fake: Fake) =>
        selector === "[data-quote-id]"
          ? "data-quote-id" in fake.attrs
          : selector === ".bb-quote"
            ? fake.attrs.class === "bb-quote"
            : fake.nodeName.toLowerCase() === selector;
      for (let at: Fake | null = self; at; at = at.parentElement)
        if (matches(at)) return at;
      return null;
    },
  };
  self.childNodes = children.map((child) =>
    typeof child === "string"
      ? {
          nodeType: 3,
          nodeName: "#text",
          textContent: child,
          childNodes: [],
          parentElement: self,
        }
      : child,
  ) as Fake[];
  for (const child of self.childNodes)
    if (child.nodeType === 1) child.parentElement = self;
  self.textContent = self.childNodes.map((child) => child.textContent).join("");
  return self;
}

const el = (name: string, ...children: (Fake | string)[]) =>
  node(name, {}, children);
const as = (fake: Fake | undefined) => fake as unknown as Node;
const body = (id: number, ...children: (Fake | string)[]) =>
  node("DIV", { ...quotableAttrs(id) }, children);
const quotableAttrs = (id: number) =>
  Object.fromEntries(
    Object.entries(quotable("post", id, { id: 9, username: "Ana" })).map(
      ([key, value]) => [key, String(value)],
    ),
  );
const range = (start: Fake, end: Fake, endOffset = 3) =>
  ({
    startContainer: as(start.childNodes[0]),
    endContainer: as(end.childNodes[0]),
    endOffset,
  }) as unknown as Parameters<typeof selectedBody>[0];

test("a selection inside one post body is quotable, and says which body", () => {
  const first = body(10, el("P", "hello world"));
  node("ARTICLE", {}, [first]);
  const paragraph = first.childNodes[0];
  expect(selectedBody(range(paragraph, paragraph))).toBe(first as never);
});

test("a selection from one post into another is not quotable", () => {
  const one = body(10, el("P", "one"));
  const two = body(11, el("P", "two"));
  node("ARTICLE", {}, [one]);
  node("ARTICLE", {}, [two]);
  expect(selectedBody(range(one.childNodes[0], two.childNodes[0]))).toBeNull();
  // Not even when the second end is the very start of the other post.
  expect(
    selectedBody(range(one.childNodes[0], two.childNodes[0], 0)),
  ).toBeNull();
});

test("a selection outside every post body is not quotable", () => {
  const outside = el("P", "the reply box");
  const one = body(10, el("P", "one"));
  node("DIV", {}, [outside, one]);
  expect(selectedBody(range(outside, outside))).toBeNull();
  expect(selectedBody(range(one.childNodes[0], outside))).toBeNull();
});

test("a selection that starts or ends inside a quote shown in the post is not quotable", () => {
  const quote = node("BLOCKQUOTE", { class: "bb-quote" }, [el("P", "quoted")]);
  const mine = el("P", "mine");
  const one = body(10, quote, mine);
  node("ARTICLE", {}, [one]);
  expect(selectedBody(range(quote.childNodes[0], mine))).toBeNull();
  expect(selectedBody(range(mine, quote.childNodes[0]))).toBeNull();
});

test("a triple click that ends at the start of what follows the text in the same post still quotes it", () => {
  const one = body(10, el("P", "last paragraph"));
  const attachments = el("DIV", "files");
  node("ARTICLE", {}, [one, attachments]);
  expect(selectedBody(range(one.childNodes[0], attachments, 0))).toBe(
    one as never,
  );
});

test("the quote carries the post and its author, and the text of the selection", () => {
  const one = body(10, el("P", "x"));
  expect(partialQuote(as(one) as Element, "just this")).toBe(
    '[QUOTE="Ana, post: 10, member: 9"]just this[/QUOTE]',
  );
  const message = node(
    "DIV",
    { ...quotableAttrs(5), "data-quote-ref": "convMessage" },
    [],
  );
  expect(partialQuote(as(message) as Element, "hi")).toBe(
    '[QUOTE="Ana, convMessage: 5, member: 9"]hi[/QUOTE]',
  );
});

test("selected formatting is kept as BB code: bold, italic, links, line breaks, paragraphs", () => {
  const selected = el(
    "DIV",
    el("P", "a ", el("STRONG", "bold"), " and ", el("EM", "italic")),
    el(
      "P",
      "see ",
      node("A", { href: "https://example.com/x" }, ["this"]),
      el("BR"),
      "next line",
    ),
  );
  expect(bbOf(as(selected))).toBe(
    "a [B]bold[/B] and [I]italic[/I]\n\nsee [URL=https://example.com/x]this[/URL]\nnext line",
  );
});

test("a quote inside the selection stays a quote without its author line, and code stays code", () => {
  const selected = el(
    "DIV",
    node("BLOCKQUOTE", { class: "bb-quote" }, [
      el("CITE", "Bob"),
      "inner text",
    ]),
    el("P", "after"),
    el("PRE", "let x = 1;"),
  );
  expect(bbOf(as(selected))).toBe(
    "[QUOTE]inner text[/QUOTE]\n\nafter\n\n[CODE]let x = 1;[/CODE]",
  );
});

test("a link that is not absolute, and a smilie picture, give their text", () => {
  const selected = el(
    "P",
    node("A", { href: "/members/3" }, ["@Ana"]),
    " ",
    node("IMG", { alt: ":)" }, []),
  );
  expect(bbOf(as(selected))).toBe("@Ana :)");
});
