import { expect, test } from "bun:test";
import { akismetChecker, disabledSpamChecker, stopForumSpamChecker } from "./spam";

test("disabled spam checker performs no request", async () => {
  expect(await disabledSpamChecker.check({ ip: "127.0.0.1" })).toEqual({
    spam: false,
    source: "disabled",
  });
});

test("StopForumSpam adapter encodes input and reads a matched result", async () => {
  const requests: URL[] = [];
  const fetcher = async (url: URL | RequestInfo) => {
    requests.push(new URL(String(url)));
    return Response.json({ ip: { appears: 0 }, email: { appears: 1 } });
  };
  const result = await stopForumSpamChecker(fetcher).check({
    ip: "127.0.0.1",
    email: "person+tag@example.test",
  });
  expect(result).toEqual({ spam: true, source: "stopforumspam" });
  expect(requests[0]!.searchParams.get("email")).toBe("person+tag@example.test");
});

test("Akismet adapter posts form data and rejects an invalid verdict", async () => {
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body as URLSearchParams;
    expect(body.get("api_key")).toBe("key");
    expect(body.get("comment_content")).toBe("message");
    return new Response("true");
  };
  expect(
    await akismetChecker("key", "https://example.test", fetcher).check({
      ip: "127.0.0.1",
      body: "message",
    }),
  ).toEqual({ spam: true, source: "akismet" });
  const invalid = async () => new Response("unknown");
  await expect(
    akismetChecker("key", "https://example.test", invalid).check({ ip: "127.0.0.1" }),
  ).rejects.toThrow("Invalid Akismet response");
});
