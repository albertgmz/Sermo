import { expect, test } from "bun:test";
import { quoteParts } from "./bb-quote";

test("a quote of a post gives its author, the post and the text", () => {
  expect(
    quoteParts('[QUOTE="Fulano, post: 12, member: 3"]hola[/QUOTE]'),
  ).toEqual({ author: "Fulano", href: "/posts/12", inner: "hola" });
});

test("a quote of a conversation message names the message", () => {
  expect(
    quoteParts('[QUOTE="Fulano, convMessage: 8, member: 3"]hola[/QUOTE]'),
  ).toEqual({
    author: "Fulano",
    href: "/conversations/messages/8",
    inner: "hola",
  });
});

test("a name may hold commas and colons, and a quote may use apostrophes or a bare name", () => {
  expect(quoteParts('[QUOTE="Ann, the 1st: x, post: 5"]a[/QUOTE]')).toEqual({
    author: "Ann, the 1st: x",
    href: "/posts/5",
    inner: "a",
  });
  expect(quoteParts("[QUOTE='Ana, post: 5, member: 2']a[/QUOTE]").href).toBe(
    "/posts/5",
  );
  expect(quoteParts("[QUOTE=Ana]a[/QUOTE]")).toEqual({
    author: "Ana",
    href: null,
    inner: "a",
  });
});

test("a quote with no option has no author and keeps its text as it is", () => {
  expect(quoteParts("[QUOTE] a [QUOTE]b[/QUOTE] [/quote]")).toEqual({
    author: null,
    href: null,
    inner: " a [QUOTE]b[/QUOTE] ",
  });
});
