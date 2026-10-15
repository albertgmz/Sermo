import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { profilePostBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const asked: { url: string; method: string; body: unknown }[] = [];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=live" }),
  cookies: async () => ({ set: () => {} }),
}));

const { postStatus } = await import("./status-action");

let create: () => Response;

beforeEach(() => {
  asked.length = 0;
  create = () => Response.json(profilePostBody({ profileUserId: 1 }));
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/me")) return Response.json(viewerBody(true));
    asked.push({
      url,
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return create();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (body: string) => {
  const data = new FormData();
  data.append("body", body);
  return data;
};

test("the status is a wall post on the member's own wall, whatever the form says", async () => {
  const data = form("Away until Friday");
  data.append("userId", "99");
  const state = await postStatus({}, data);
  expect(state).toEqual({ posted: true });
  expect(asked).toHaveLength(1);
  expect(asked[0].url).toEndWith("/users/1/profile-posts");
  expect(asked[0].method).toBe("POST");
  expect(asked[0].body).toEqual({
    body: "Away until Friday",
    attachmentIds: [],
  });
});

test("the backend's refusal comes back for the form to show", async () => {
  create = () =>
    Response.json(
      { error: { code: "forbidden", message: "You may not post here." } },
      { status: 403 },
    );
  const state = await postStatus({}, form("hello"));
  expect(state.posted).toBeUndefined();
  expect(state.error).toBe("You may not post here.");
});
