import { afterEach, expect, mock, test } from "bun:test";
import {
  type Asked,
  fakeBackend,
  refusal,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";

let cookie = "";
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, toString: () => cookie }),
}));

const { findMentions } = await import("./mention-find");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  backend = undefined;
  cookie = "";
});

const found = () =>
  Response.json({
    items: [
      { id: 1, username: "Lucien", staff: true },
      { id: 2, username: "Lucia", staff: false },
    ],
  });

const card = (id: number, username: string, extra: object) => ({
  id,
  username,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
  ...extra,
});

const cards = () =>
  Response.json({
    items: [
      card(1, "Lucien", {
        avatar: { url: "/files/9", smallUrl: "/files/10" },
        nameColor: "#cc0000",
        title: "Administrator",
      }),
      card(2, "Lucia", { title: "New member" }),
    ],
  });

const operations = (asked: Asked[]) => asked.map((entry) => entry.operation);

test("each member found comes with the avatar, name colour, title and staff mark", async () => {
  backend = fakeBackend({ "users.search": found, "users.cards": cards });
  expect(await findMentions("Luc")).toEqual([
    {
      id: 1,
      username: "Lucien",
      avatar: "/files/10",
      nameColor: "#cc0000",
      title: "Administrator",
      staff: true,
    },
    {
      id: 2,
      username: "Lucia",
      avatar: null,
      nameColor: null,
      title: "New member",
      staff: false,
    },
  ]);
  expect(operations(backend.asked)).toEqual(["users.search", "users.cards"]);
});

test("a visitor who switched avatars off is sent no avatar address", async () => {
  cookie = "forum_lite=avatars";
  backend = fakeBackend({ "users.search": found, "users.cards": cards });
  const hits = await findMentions("Luc");
  expect(hits.map((hit) => hit.avatar)).toEqual([null, null]);
});

test("nothing found asks for no cards", async () => {
  backend = fakeBackend({
    "users.search": () => Response.json({ items: [] }),
  });
  expect(await findMentions("zz")).toEqual([]);
  expect(operations(backend.asked)).toEqual(["users.search"]);
});

test("a refused search offers nobody", async () => {
  backend = fakeBackend({
    "users.search": () => refusal(403, "forbidden"),
  });
  expect(await findMentions("Luc")).toEqual([]);
});
