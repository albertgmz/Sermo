import { afterEach, expect, test } from "bun:test";
import { contracts as c } from "@sermo/core";
import { cleanupEconomy, error, setup } from "./economy-fixtures.test";

afterEach(cleanupEconomy);

test("the newest page of a conversation is a query parameter of its messages route", async () => {
  const f = await setup();
  const started = await f.api(
    c.conversationsCreate,
    "POST",
    "/conversations",
    f.member.auth,
    { title: "Ordered", recipientIds: [f.other.id], body: "first" },
    201,
  );
  const id = started.conversation.id;
  for (const body of ["second", "third"])
    await f.api(
      c.conversationsReply,
      "POST",
      `/conversations/${id}/messages`,
      f.other.auth,
      { body },
      201,
    );
  const ids = async (query: string) =>
    (
      await f.api(
        c.conversationsListMessages,
        "GET",
        `/conversations/${id}/messages${query}`,
        f.member.auth,
      )
    ).items.map((message) => message.id);
  const oldest = await ids("");
  expect(oldest).toHaveLength(3);
  expect(await ids("?order=oldest")).toEqual(oldest);
  expect(await ids("?order=newest")).toEqual([...oldest].reverse());
  const page = await f.api(
    c.conversationsListMessages,
    "GET",
    `/conversations/${id}/messages?order=newest&limit=2`,
    f.member.auth,
  );
  expect(page.items.map((message) => message.id)).toEqual([oldest[2]!, oldest[1]!]);
  expect(await ids(`?order=newest&limit=2&cursor=${page.nextCursor}`)).toEqual([oldest[0]!]);
  await error(
    f.send("GET", `/conversations/${id}/messages?order=sideways`, f.member.auth),
    400,
    "validation",
  );
  await error(
    f.send("GET", `/conversations/${id}/messages?order=newest`, f.admin.auth),
    404,
    "not_found",
  );
});

// Every read of the lists answers with `total`: a count for a numbered page, null otherwise (the
// header's panel and a poll read without a page), never left out.
test("the inbox and a conversation's messages always answer with their total", async () => {
  const f = await setup();
  const started = await f.api(
    c.conversationsCreate,
    "POST",
    "/conversations",
    f.member.auth,
    { title: "Counted", recipientIds: [f.other.id], body: "first" },
    201,
  );
  const id = started.conversation.id;
  const body = async (path: string) =>
    (await (await f.send("GET", path, f.member.auth)).json()) as Record<string, unknown>;
  expect(await body("/conversations?limit=5")).toHaveProperty("total", null);
  expect(await body("/conversations?page=1")).toHaveProperty("total", 1);
  expect(await body(`/conversations/${id}/messages`)).toHaveProperty("total", null);
  expect(await body(`/conversations/${id}/messages?afterMessageId=1`)).toHaveProperty(
    "total",
    null,
  );
  expect(await body(`/conversations/${id}/messages?page=1`)).toHaveProperty("total", 1);
});
