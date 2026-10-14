import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, toString: () => "" }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, refresh: () => {} }));
afterAll(() => {
  mock.module("next/cache", () => nextCache);
});

const source = "./member-card-action.tsx?card";
const { loadMemberCard } = (await import(
  source
)) as typeof import("./member-card-action");
const { Postbit } = await import("./postbit");
const { MemberActions } = await import("./member-actions");
const { MemberCardMinimal } = await import("./member-card");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const card = (restricted: boolean) => ({
  id: 7,
  username: "ember",
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted,
});
const author = (restricted: boolean) => ({
  card: card(restricted),
  cover: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: 3,
  reactionScore: 1,
  awardXp: 0,
  currentLevelXp: 0,
  nextLevelXp: 100,
  awards: [],
  signatureHtml: null,
});

// Answers each read by its path and records which were made.
function backend(options: {
  signedIn: boolean;
  restricted?: boolean;
  unknown?: boolean;
  authors?: Response;
  relation?: { following: boolean; canFollow: boolean; canMessage: boolean };
}) {
  const paths: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    paths.push(path);
    if (path.includes("authors"))
      return (
        options.authors ??
        Response.json({
          items: options.unknown ? [] : [author(options.restricted ?? false)],
        })
      );
    if (path.includes("relations"))
      return Response.json({
        items: [
          {
            userId: 7,
            ...(options.relation ?? {
              following: false,
              canFollow: true,
              canMessage: true,
            }),
          },
        ],
      });
    return Response.json(viewerBody(options.signedIn));
  }) as unknown as typeof fetch;
  return paths;
}

const reads = (paths: string[]) =>
  paths.filter((path) => /authors|relations/.test(path)).sort();

function element(node: unknown) {
  return node as ReactElement<{
    author?: unknown;
    layout?: string;
    actions?: ReactNode;
    name?: string;
  }>;
}

test("a member: the postbit as a column with labelled actions, from two reads", async () => {
  const paths = backend({ signedIn: true });
  const out = element(await loadMemberCard(7, "ember"));
  expect(out.type).toBe(Postbit);
  expect(out.props.layout).toBe("column");
  const actions = element(out.props.actions);
  expect(actions.type).toBe(MemberActions);
  expect(
    (actions.props as unknown as { form: string; relation: unknown }).form,
  ).toBe("labelled");
  expect((actions.props as unknown as { relation: unknown }).relation).toEqual({
    following: false,
    canFollow: true,
    canMessage: true,
  });
  expect(reads(paths)).toHaveLength(2);
});

test("a guest: one read, no relation to act on", async () => {
  const paths = backend({ signedIn: false });
  const out = element(await loadMemberCard(7, "ember"));
  expect(out.type).toBe(Postbit);
  const actions = element(out.props.actions);
  expect(
    (actions.props as unknown as { relation: unknown }).relation,
  ).toBeNull();
  expect(reads(paths)).toHaveLength(1);
  expect(reads(paths)[0]).toContain("authors");
});

test("yourself: the backend offers nothing, so no action is drawn", async () => {
  backend({
    signedIn: true,
    relation: { following: false, canFollow: false, canMessage: false },
  });
  const { hasMemberActions } = await import("./member-actions-view");
  const out = element(await loadMemberCard(7, "ember"));
  const props = element(out.props.actions).props as unknown as {
    member: { restricted: boolean };
    relation: { following: boolean; canFollow: boolean; canMessage: boolean };
  };
  expect(hasMemberActions(props.member, props.relation)).toBe(false);
});

test("a member the viewer may not open, or an unknown one: the name alone", async () => {
  backend({ signedIn: true, restricted: true });
  const restricted = element(await loadMemberCard(7, "ember"));
  expect(restricted.type).toBe(MemberCardMinimal);
  expect(restricted.props.name).toBe("ember");
  backend({ signedIn: true, unknown: true });
  const unknown = element(await loadMemberCard(7, "ember"));
  expect(unknown.type).toBe(MemberCardMinimal);
});

test("a refusal that means closed gives the name alone; any other failure is passed on", async () => {
  backend({
    signedIn: true,
    authors: Response.json(
      { error: { code: "forbidden", message: "No." } },
      { status: 403 },
    ),
  });
  expect(element(await loadMemberCard(7, "ember")).type).toBe(
    MemberCardMinimal,
  );
  backend({
    signedIn: true,
    authors: Response.json(
      { error: { code: "internal", message: "Boom." } },
      { status: 500 },
    ),
  });
  await expect(loadMemberCard(7, "ember")).rejects.toThrow();
});

test("an id that is not a record id reads nothing", async () => {
  const paths = backend({ signedIn: true });
  expect(await loadMemberCard(0, "ember")).toBeNull();
  expect(paths).toHaveLength(0);
});

test("a name that is not a string reads nothing", async () => {
  const paths = backend({ signedIn: true });
  expect(await loadMemberCard(7, 5 as unknown as string)).toBeNull();
  expect(paths).toHaveLength(0);
});
