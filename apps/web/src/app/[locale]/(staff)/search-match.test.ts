import { expect, test } from "bun:test";
import { fold, type SearchEntry, searchEntries } from "./search-match";

const entry = (
  label: string,
  more: Partial<Omit<SearchEntry, "label">> = {},
): SearchEntry => ({
  kind: "setting",
  label,
  help: "",
  id: "",
  path: [],
  href: `/admin/${label}`,
  ...more,
});

const labels = (entries: SearchEntry[], query: string) =>
  searchEntries(entries, query).map((hit) => hit.entry.label);

test("case and accents do not matter, in the query or in the text", () => {
  expect(fold("Invitádos ÑANDÚ")).toBe("invitados nandu");
  const guests = [entry("Invitados")];
  for (const query of ["invitados", "Invitados", "invitádos", "INVITÁDOS"])
    expect(labels(guests, query), query).toEqual(["Invitados"]);
});

test("every word of the query must begin a word of the text", () => {
  const entries = [
    entry("Cloudflare Turnstile secret"),
    entry("Signature lines"),
  ];
  expect(labels(entries, "turn")).toEqual(["Cloudflare Turnstile secret"]);
  expect(labels(entries, "secret turn")).toEqual([
    "Cloudflare Turnstile secret",
  ]);
  // Inside a word is no match, and one word that matches nothing rules the entry out.
  expect(labels(entries, "nstile")).toEqual([]);
  expect(labels(entries, "turnstile lines")).toEqual([]);
});

test("the technical id matches, whole or by its parts", () => {
  const entries = [
    entry("Post as a guest", { kind: "permission", id: "forum.guestPost" }),
    entry("Site key", { id: "turnstileSiteKey" }),
  ];
  for (const query of ["guestPost", "forum.guestPost", "forum.guest", "guest"])
    expect(labels(entries, query), query).toEqual(["Post as a guest"]);
  expect(labels(entries, "turnstile")).toEqual(["Site key"]);
  // The parts of a camel-case id, in any order.
  expect(labels(entries, "site turnstile")).toEqual(["Site key"]);
  expect(labels(entries, "key turnstile")).toEqual(["Site key"]);
  expect(searchEntries(entries, "turnstile key")[0].via).toBe("id");
  expect(searchEntries(entries, "guestPost")[0].via).toBe("id");
  expect(searchEntries(entries, "guest")[0].via).toBe("label");
});

test("the help text matches too, after the label", () => {
  const entries = [
    entry("Flood interval", { help: "Seconds a member waits between posts." }),
  ];
  const [hit] = searchEntries(entries, "waits");
  expect(hit.entry.label).toBe("Flood interval");
  expect(hit.via).toBe("help");
});

test("the exact label comes first, then a label that begins with the query, then other label words, then the id, then the help", () => {
  const entries = [
    entry("In the help", { help: "Guest forms are guarded." }),
    entry("By id", { id: "guestForms" }),
    entry("Forms for a guest"),
    entry("Guest forms and more"),
    entry("Guest forms"),
  ];
  expect(labels(entries, "guest forms")).toEqual([
    "Guest forms",
    "Guest forms and more",
    "Forms for a guest",
    "By id",
    "In the help",
  ]);
});

test("equal matches keep the order of the index", () => {
  const entries = [
    entry("Members", { kind: "screen" }),
    entry("Member limit"),
    entry("Members may post", { kind: "permission" }),
  ];
  expect(labels(entries, "mem")).toEqual([
    "Members",
    "Member limit",
    "Members may post",
  ]);
});

test("an empty query, or one of only spaces and signs, finds nothing", () => {
  const entries = [entry("Anything")];
  expect(searchEntries(entries, "")).toEqual([]);
  expect(searchEntries(entries, "   ")).toEqual([]);
  expect(searchEntries(entries, " - . ")).toEqual([]);
});

test("at most the limit is returned", () => {
  const entries = Array.from({ length: 80 }, (_, n) => entry(`Rule ${n}`));
  expect(searchEntries(entries, "rule")).toHaveLength(50);
  expect(searchEntries(entries, "rule", 5)).toHaveLength(5);
});
