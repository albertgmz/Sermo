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
const { MemberTooltip } = await import("./member-tooltip");
const { MemberCardScope } = await import("./member-card-scope");
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
  lastActivityAt: null,
  lastActivityHidden: false,
});

// Answers each read by its path and records which were made.
function backend(options: {
  signedIn: boolean;
  restricted?: boolean;
  unknown?: boolean;
  authors?: Response;
  relation?: {
    following: boolean;
    canFollow: boolean;
    canMessage: boolean;
    blocking: boolean;
    canBlock: boolean;
  };
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
              blocking: false,
              canBlock: true,
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

type Props = {
  author?: unknown;
  actions?: ReactNode;
  name?: string;
  children?: ReactNode;
  disabled?: boolean;
};

function element(node: unknown) {
  return node as ReactElement<Props>;
}

// The card of a member: the tooltip (with the member's actions, if any, and the link to the
// profile), inside a scope that keeps names and avatars plain links.
function cardOf(node: unknown) {
  const scope = element(node);
  expect(scope.type).toBe(MemberCardScope);
  expect(scope.props.disabled).toBe(true);
  const tooltip = element(scope.props.children);
  return {
    tooltip,
    actions: tooltip.props.actions ? element(tooltip.props.actions) : undefined,
  };
}

test("a member: the tooltip with its actions in a row, from two reads", async () => {
  const paths = backend({ signedIn: true });
  const { tooltip, actions } = cardOf(await loadMemberCard(7, "ember"));
  expect(tooltip.type).toBe(MemberTooltip);
  expect((tooltip.props.author as { member: { id: number } }).member.id).toBe(
    7,
  );
  expect(actions?.type).toBe(MemberActions);
  const given = actions?.props as unknown as {
    form?: string;
    relation: unknown;
  };
  expect(given.form).toBe("row");
  expect(given.relation).toEqual({
    following: false,
    canFollow: true,
    canMessage: true,
    blocking: false,
    canBlock: true,
  });
  expect(reads(paths)).toHaveLength(2);
});

test("a guest: one read, no actions", async () => {
  const paths = backend({ signedIn: false });
  const { tooltip, actions } = cardOf(await loadMemberCard(7, "ember"));
  expect(tooltip.type).toBe(MemberTooltip);
  expect(actions).toBeUndefined();
  expect(reads(paths)).toHaveLength(1);
  expect(reads(paths)[0]).toContain("authors");
});

test("yourself: the backend offers nothing, so no action is drawn", async () => {
  backend({
    signedIn: true,
    relation: {
      following: false,
      canFollow: false,
      canMessage: false,
      blocking: false,
      canBlock: false,
    },
  });
  const { actions } = cardOf(await loadMemberCard(7, "ember"));
  expect(actions).toBeUndefined();
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
