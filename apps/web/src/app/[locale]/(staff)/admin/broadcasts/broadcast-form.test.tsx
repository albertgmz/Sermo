import { afterAll, expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { htmlOf, mockIntl } from "../credits/test-render";

const restore = await mockIntl();
const { BroadcastView } = await import("./broadcast-form");
afterAll(restore);

const form = messages.adminCommunication.broadcasts.form;
const result = messages.adminCommunication.broadcasts.result;
const groups = [
  { id: 3, title: "Moderators" },
  { id: 4, title: "Administrators" },
];
const view = (kind: "message" | "alert", state = null as never) =>
  htmlOf(
    <BroadcastView
      kind={kind}
      groups={groups}
      rule={<div>rule builder</div>}
      state={state}
      formAction={() => {}}
    />,
  );

test("a message asks for sender, title and text, and has the three steps", async () => {
  const html = await view("message");
  expect(html).toContain('name="title"');
  expect(html).toContain('name="body"');
  expect(html).toContain('name="removeFromSender"');
  expect(html).not.toContain('name="text"');
  for (const step of ["test", "count", "send"])
    expect(html).toMatch(
      new RegExp(`<button[^>]*value="${step}"[^>]*name="step"`),
    );
  // The password and the confirmation belong to the send alone.
  expect(html).toContain('name="actorPassword"');
  expect(html).toContain('name="confirm"');
  expect(html).toContain('name="groupIds"');
  expect(html).toContain("rule builder");
});

test("an alert asks for the text and the link only", async () => {
  const html = await view("alert");
  expect(html).toContain('name="text"');
  expect(html).toContain('name="url"');
  expect(html).not.toContain('name="body"');
  expect(html).toContain('name="kind" value="alert"');
});

test("a delivered test links to its conversation; a refused one says why", async () => {
  const delivered = await view("message", {
    test: { name: "Wren", delivered: true, reason: null, conversationId: 12 },
  } as never);
  expect(delivered).toContain(result.tested.replace("{name}", "Wren"));
  expect(delivered).toContain('href="/conversations/12"');
  const refused = await view("message", {
    test: {
      name: "Wren",
      delivered: false,
      reason: "No.",
      conversationId: null,
    },
  } as never);
  expect(refused).toContain(
    result.notDelivered.replace("{name}", "Wren").replace("{reason}", "No."),
  );
  expect(form.test).toBeDefined();
});
