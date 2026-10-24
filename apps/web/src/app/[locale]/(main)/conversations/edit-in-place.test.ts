import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { isValidElement } from "react";

// A conversation message edited where it is read, as a thread post is: what its editor opens with
// and the save, which answer only a participant the backend lets edit the message. The backend
// answers anyone else (a member outside the conversation first) not found, and then nothing of the
// message is handed out or drawn.

const realFetch = globalThis.fetch;
const asked: { method: string; path: string; body: unknown }[] = [];
let answers: Record<string, { status?: number; body: unknown }> = {};

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

const { messageBody } = await import("@/lib/test-bodies");
const { viewerBody } = await import("@/lib/test-viewer");
const inPlace = await import("./edit-in-place");

const NOT_FOUND = {
  status: 404,
  body: { error: { code: "not_found", message: "Not found." } },
};
const file = {
  fileId: 6,
  url: "/attachments/6/notes.txt",
  contentType: "text/plain",
  byteSize: 12,
  width: null,
  height: null,
  filename: "notes.txt",
  thumbnailUrl: null,
  widths: [],
};
const viewer = (resolvedPermissions: Record<string, boolean>) => ({
  ...viewerBody(true),
  resolvedPermissions,
});

beforeEach(() => {
  asked.length = 0;
  answers = { "GET /me": { body: viewer({}) } };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname.replace("/api/v1", "");
    asked.push({
      method,
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const given = answers[`${method} ${path}`] ?? NOT_FOUND;
    return Response.json(given.body, { status: given.status ?? 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const writes = () => asked.filter(({ method }) => method !== "GET");

test("the editor opens with the message's BB code and its files, with no thread title", async () => {
  answers["GET /conversation-messages/11"] = {
    body: messageBody({
      bodySource: "[b]hi[/b]",
      canEdit: true,
      attachments: [file],
      attachmentCount: 1,
    }),
  };
  const opened = await inPlace.messageEditorAction(5, 11);
  if ("error" in opened) throw new Error(opened.error);
  expect(opened.fields).toEqual({
    source: "[b]hi[/b]",
    // Conversation files are uploaded without a forum, to the conversations' own route.
    attachIn: null,
    withFiles: true,
    attached: [{ id: 6, name: "notes.txt", size: 12, type: "text/plain" }],
    thread: null,
  });
  // The quick editor's file field sends there, as the message's edit page does.
  const { uploadAddress } = await import("@/components/forum/attachment-field");
  expect(uploadAddress(opened.fields.attachIn ?? undefined)).toBe(
    "/attachments",
  );
});

test("without the right to attach, a message with no files opens with no file field", async () => {
  answers["GET /me"] = { body: viewer({ "conversation.attach": false }) };
  answers["GET /conversation-messages/11"] = {
    body: messageBody({ canEdit: true }),
  };
  const opened = await inPlace.messageEditorAction(5, 11);
  if ("error" in opened) throw new Error(opened.error);
  expect(opened.fields.withFiles).toBe(false);
});

test("a member outside the conversation, or one who may not edit the message, opens nothing", async () => {
  // The backend's answer to a non-participant: not found.
  const outside = await inPlace.messageEditorAction(5, 11);
  expect("fields" in outside).toBe(false);
  expect(outside).toEqual({ error: "Not found." });
  // A message of another conversation is not opened under this one's address.
  answers["GET /conversation-messages/11"] = {
    body: messageBody({ canEdit: true, conversationId: 6, bodySource: "x" }),
  };
  expect(await inPlace.messageEditorAction(5, 11)).toEqual({ error: "" });
  answers["GET /conversation-messages/11"] = {
    body: messageBody({ canEdit: false, bodySource: "x" }),
  };
  expect(await inPlace.messageEditorAction(5, 11)).toEqual({ error: "" });
  expect(writes()).toEqual([]);
});

test("saving in place sends the text and answers with the message drawn as the page draws it", async () => {
  answers["PATCH /conversation-messages/11"] = {
    body: messageBody({
      bodyHtml: "<p>new words</p>",
      editedAt: "2026-02-01T00:00:00.000Z",
    }),
  };
  const saved = await inPlace.saveMessageInPlace(
    5,
    11,
    true,
    form({ body: "new words" }),
  );
  if ("error" in saved) throw new Error(saved.error);
  expect(writes()).toEqual([
    {
      method: "PATCH",
      path: "/conversation-messages/11",
      body: { body: "new words" },
    },
  ]);
  // The body a post is drawn with, as a conversation message's, and quotable by selection as one.
  expect(isValidElement(saved.body)).toBe(true);
  const body = saved.body as {
    props: { post: { bodyHtml: string }; type: string; quote?: unknown };
  };
  expect(body.props.post.bodyHtml).toBe("<p>new words</p>");
  expect(body.props.type).toBe("conversation_message");
  expect(body.props.quote).toEqual({
    "data-quote-ref": "convMessage",
    "data-quote-id": 11,
    "data-quote-author": "ember",
    "data-quote-author-id": 3,
  });
  expect((saved.edited as { props: { date: string } }).props.date).toBe(
    "2026-02-01T00:00:00.000Z",
  );
});

test("a viewer who may not quote here gets the message drawn without the quote hooks", async () => {
  answers["PATCH /conversation-messages/11"] = { body: messageBody() };
  const saved = await inPlace.saveMessageInPlace(
    5,
    11,
    false,
    form({ body: "b" }),
  );
  if ("error" in saved) throw new Error(saved.error);
  expect(
    (saved.body as { props: { quote?: unknown } }).props.quote,
  ).toBeUndefined();
});

test("a save the backend refuses, as it refuses a member outside the conversation, draws nothing", async () => {
  const saved = await inPlace.saveMessageInPlace(
    5,
    11,
    true,
    form({ body: "b" }),
  );
  expect(saved).toEqual({ error: "Not found." });
});
