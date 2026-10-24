import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

// The one quick reply of a thread and of a conversation: the same form, editor and buttons, with
// only its sends (bound by the page to what is answered), the copy and the files handed in.

// The editor loads Lexical when it is first used; what matters here is what it is told to listen to.
mock.module("@/components/forum/lazy-editor", () => ({
  LazyEditor: (props: { insertEvent?: string; placeholder?: string }) =>
    createElement("textarea", {
      "data-insert-event": props.insertEvent,
      placeholder: props.placeholder,
    }),
}));
// The sends the form hands its tail, as it handed them, so they can be run here.
type TailOptions = Parameters<
  typeof import("@/components/forum/use-tail-form").useTailForm
>[0];
let handed: TailOptions | undefined;
const realTail = { ...(await import("@/components/forum/use-tail-form")) };
mock.module("@/components/forum/use-tail-form", () => ({
  useTailForm: (options: TailOptions) => {
    handed = options;
    return realTail.useTailForm(options);
  },
}));
const { ReplyComposer } = await import("./reply-composer");

const sent: string[] = [];
// A conversation's sends, as its page binds them to the conversation.
const conversationSends = {
  replyInPlace: async () => {
    sent.push("in place to conversation 7");
    return {};
  },
  replyAction: async () => {
    sent.push("to conversation 7");
    return {};
  },
};
const draw = (files: { nodeId?: number } | null) =>
  renderToStaticMarkup(
    withIntl(
      createElement(ReplyComposer, {
        ...conversationSends,
        tailKey: "conversation:7",
        files,
        placeholder: "Write a message…",
        submitLabel: "Send message",
      }),
    ),
  );

test("a conversation's reply is the thread's form: its editor takes what Quote and a selection send", () => {
  const html = draw(null);
  expect(html).toContain(`data-insert-event="${QUOTE_EVENT}"`);
  // The `r` shortcut finds it, as on a thread.
  expect(html).toContain('data-shortcut="reply"');
});

test("under the editor, Attach files and then the submit with a reply icon, with the copy handed in", () => {
  const html = draw({});
  expect(html).toContain('placeholder="Write a message…"');
  const attach = html.indexOf(messages.forum.attachmentField.attach);
  const submit = html.search(/<button[^>]*type="submit"/);
  expect(attach).toBeGreaterThan(-1);
  expect(submit).toBeGreaterThan(attach);
  expect(html.slice(submit)).toMatch(/lucide-reply[^>]*>.*<\/svg>Send message/);
});

test("without the right to attach there is no Attach files", () => {
  expect(draw(null)).not.toContain(messages.forum.attachmentField.attach);
});

test("a conversation's reply goes out through the conversation's sends, in place and by redirect", async () => {
  sent.length = 0;
  handed = undefined;
  draw(null);
  // Set by the stand-in while drawing, which the compiler cannot follow.
  const options = handed as TailOptions | undefined;
  if (!options) throw new Error("the form handed its tail no sends");
  expect(options.tailKey).toBe("conversation:7");
  await options.send(new FormData());
  await options.redirecting({}, new FormData());
  expect(sent).toEqual(["in place to conversation 7", "to conversation 7"]);
});
