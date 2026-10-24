import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

// What a guest sees where a forum lets guests post: the usual composers without files, tags,
// polls or watching, with a name and the security check, and a notice once the post is taken.

const guestActions = await import(
  "@/app/[locale]/(main)/guest-posting/actions"
);
const sent: string[] = [];
mock.module("@/app/[locale]/(main)/guest-posting/actions", () => ({
  guestReplyAction: async (threadId: number, _: unknown, data: FormData) => {
    sent.push(`reply to ${threadId} as ${data.get("name")}`);
    return { done: true };
  },
  guestThreadAction: async (nodeId: number, _: unknown, data: FormData) => {
    sent.push(`thread in ${nodeId} as ${data.get("name")}`);
    return { done: true };
  },
}));
// The editor loads Lexical when first used; a plain box stands in for it.
mock.module("@/components/forum/lazy-editor", () => ({
  LazyEditor: (props: { name?: string; placeholder?: string }) =>
    createElement("textarea", {
      name: props.name,
      placeholder: props.placeholder,
    }),
}));
// The state the form is in, and the action it handed to the form hook.
type Hook = typeof import("@/components/forum/use-kept-form").useKeptForm;
let state: Record<string, unknown> = {};
let handed: Parameters<Hook>[0] | undefined;
const realKept = { ...(await import("@/components/forum/use-kept-form")) };
mock.module("@/components/forum/use-kept-form", () => ({
  ...realKept,
  useKeptForm: (action: Parameters<Hook>[0]) => {
    handed = action;
    return { state, pending: false, onSubmit: () => {} };
  },
}));
const { GuestReplyForm } = await import("./guest-reply-form");
const { GuestThreadComposer } = await import("./guest-thread-composer");

afterAll(() => {
  mock.module(
    "@/app/[locale]/(main)/guest-posting/actions",
    () => guestActions,
  );
  mock.module("@/components/forum/use-kept-form", () => realKept);
});

const draw = (node: React.ReactElement) => renderToStaticMarkup(withIntl(node));
const reply = () =>
  draw(
    <GuestReplyForm
      threadId={7}
      backHref="/threads/7"
      turnstileKey="site-key"
      placeholder="Write your reply…"
      submitLabel="Post reply"
    />,
  );
const thread = () =>
  draw(
    <GuestThreadComposer
      forumId={3}
      prefixes={[]}
      requirePrefix={false}
      turnstileKey="site-key"
    />,
  );

test("the guest's reply box asks for a name beside the text and carries the Turnstile token", () => {
  state = {};
  const html = reply();
  expect(html).toContain('placeholder="Write your reply…"');
  expect(html).toContain('name="name"');
  expect(html).toContain(`>${messages.forum.guestPosting.nameLabel}</label>`);
  expect(html).toContain('name="turnstileToken"');
  expect(html).toContain(messages.forum.guestPosting.reviewHint);
  expect(html).toContain("Post reply");
  expect(html).not.toContain(messages.forum.attachmentField.attach);
});

test("sending the reply calls the guest action for the thread", async () => {
  state = {};
  reply();
  sent.length = 0;
  const data = new FormData();
  data.set("name", "Wanderer");
  await handed?.({}, data);
  expect(sent).toEqual(["reply to 7 as Wanderer"]);
});

test("a reply that was taken is replaced by the notice that it awaits approval, with the way back to the thread", () => {
  state = { done: true };
  const html = reply();
  expect(html).toContain(messages.forum.guestPosting.awaitingTitle);
  expect(html).toContain(messages.forum.guestPosting.awaitingBody);
  expect(html).toContain('role="status"');
  expect(html).toContain('href="/threads/7"');
  expect(html).not.toContain('name="name"');
  expect(html).not.toContain("<textarea");
});

test("a refused name is said under the name field, the other refusals under the form", () => {
  state = { nameError: "That name belongs to a member." };
  const named = reply();
  expect(named).toContain("That name belongs to a member.");
  expect(named).toContain('aria-invalid="true"');
  expect(named).not.toContain(messages.forum.guestPosting.nameHelp);

  state = { error: "The security check failed." };
  const form = reply();
  expect(form).toContain("The security check failed.");
  expect(form).toContain(messages.forum.guestPosting.nameHelp);
});

test("a guest's new thread has a title, the text, a name and the token, and none of the member's extras", () => {
  state = {};
  const html = thread();
  expect(html).toContain('name="title"');
  expect(html).toContain('name="body"');
  expect(html).toContain('name="name"');
  expect(html).toContain('name="turnstileToken"');
  expect(html).not.toContain('name="watch"');
  expect(html).not.toContain('name="tags"');
  expect(html).not.toContain('name="poll"');
  expect(html).not.toContain(messages.forum.attachmentField.attach);
  expect(html).not.toContain(messages.forum.threadComposer.postingIn);
});

test("sending the thread calls the guest action for the forum, and what follows is the notice with the way back to the forum", async () => {
  state = {};
  thread();
  sent.length = 0;
  const data = new FormData();
  data.set("name", "Wanderer");
  await handed?.({}, data);
  expect(sent).toEqual(["thread in 3 as Wanderer"]);

  state = { done: true };
  const html = thread();
  expect(html).toContain(messages.forum.guestPosting.awaitingTitle);
  expect(html).toContain('href="/forums/3"');
  expect(html).not.toContain('name="title"');
});
