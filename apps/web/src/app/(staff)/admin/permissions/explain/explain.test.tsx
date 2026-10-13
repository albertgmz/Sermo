import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { permissionDefinitionBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { fakeBackend } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { Explain } = await import("./explain");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const member = {
  id: 3,
  username: "ember",
  avatar: null,
  frame: null,
  nameColor: null,
  title: "Member",
  badges: [],
  level: 1,
  restricted: false,
};

// Every string a rendered tree carries as children, in order.
function texts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object" && "props" in node) {
    return texts((node as { props: { children?: unknown } }).props.children);
  }
  return [];
}

function ask(params: Record<string, string>) {
  backend = fakeBackend({
    "permissions.definitions": () =>
      Response.json({
        items: [
          permissionDefinitionBody("forum.edit", "flag", "node"),
          permissionDefinitionBody("profile.view", "flag"),
        ],
      }),
    "nodes.list": () => Response.json({ items: [], nextCursor: null }),
    "users.cards": () => Response.json({ items: [member] }),
    "permissions.explain": () =>
      Response.json({
        permission: "x",
        scope: "node",
        granted: true,
        value: null,
        nodeId: null,
        deniedBy: null,
        layers: [],
      }),
  });
  return Explain({ searchParams: Promise.resolve({ user: "3", ...params }) });
}

const line = messages.adminGroups.explain.forumRequired;

test("a permission of forum scope with no forum chosen gets the form's line and no question to the backend", async () => {
  const page = await ask({ permission: "forum.edit" });
  expect(texts(page).join("|")).toContain(line);
  expect(
    backend?.asked.some((call) => call.operation === "permissions.explain"),
  ).toBe(false);
});

test("a permission of forum scope with a forum chosen is asked", async () => {
  const page = await ask({ permission: "forum.edit", node: "2" });
  expect(texts(page).join("|")).not.toContain(line);
  expect(
    backend?.asked.filter((call) => call.operation === "permissions.explain"),
  ).toHaveLength(1);
});

test("a global permission needs no forum", async () => {
  const page = await ask({ permission: "profile.view" });
  expect(texts(page).join("|")).not.toContain(line);
  expect(
    backend?.asked.filter((call) => call.operation === "permissions.explain"),
  ).toHaveLength(1);
});
