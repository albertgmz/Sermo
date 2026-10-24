import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The conversation's sends, which the page binds to the conversation it answers.
const sent: string[] = [];
mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  replyAction: async (id: number) => {
    sent.push(`to conversation ${id}`);
    return {};
  },
}));
mock.module("@/app/[locale]/(main)/conversations/reply-in-place", () => ({
  replyInPlace: async (id: number) => {
    sent.push(`in place to conversation ${id}`);
    return {};
  },
}));
// The thread's quick reply, which the conversation uses, as it is handed its props.
type ComposerProps = {
  files: object | null;
  replyInPlace: (data: FormData) => Promise<unknown>;
  replyAction: (previous: object, data: FormData) => Promise<unknown>;
};
let composer: ComposerProps | undefined;
mock.module("@/app/[locale]/(main)/threads/[id]/reply-composer", () => ({
  ReplyComposer: (props: ComposerProps) => {
    composer = props;
    return createElement("form", {
      id: "reply-form",
      "data-attach": String(props.files !== null),
    });
  },
}));

const { LockedBadge, ReplyArea } = await import("./locked-state");

const stamp = "2026-03-04T10:00:00.000Z";
const conversation = {
  id: 7,
  title: "Plans",
  starter: { id: 1, username: "ember" },
  createdAt: stamp,
  lastMessage: {
    messageId: 9,
    sentAt: stamp,
    user: { kind: "member" as const, id: 1, username: "ember" },
  },
  messageCount: 4,
  participantCount: 2,
  isUnread: false,
  participants: [],
  canReply: true,
  canInvite: false,
  canRename: false,
  isLocked: false,
  canLock: false,
};
const NOTE = "This direct message is closed to new replies.";
const draw = (over: Partial<typeof conversation>, canAttach?: boolean) =>
  renderToStaticMarkup(
    withIntl(
      createElement(ReplyArea, {
        conversation: { ...conversation, ...over },
        tailKey: "conversation:3",
        canAttach,
      }),
    ),
  );

test("the badge says the conversation is locked", () => {
  expect(renderToStaticMarkup(withIntl(createElement(LockedBadge)))).toContain(
    "Locked",
  );
});

test("an open conversation shows the form alone", () => {
  const html = draw({});
  expect(html).toContain("reply-form");
  expect(html).not.toContain(NOTE);
});

test("a moderator of a locked conversation sees the note above the form", () => {
  const html = draw({ isLocked: true });
  expect(html).toContain(NOTE);
  expect(html).toContain("reply-form");
  expect(html.indexOf(NOTE)).toBeLessThan(html.indexOf("reply-form"));
});

test("the form is told whether files may be attached", () => {
  expect(draw({}, false)).toContain('data-attach="false"');
  expect(draw({}, true)).toContain('data-attach="true"');
});

test("the form is the thread's quick reply, sending to this conversation", async () => {
  composer = undefined;
  sent.length = 0;
  draw({});
  // Set by the stand-in while drawing, which the compiler cannot follow.
  const props = composer as ComposerProps | undefined;
  if (!props) throw new Error("no reply form was drawn");
  await props.replyInPlace(new FormData());
  await props.replyAction({}, new FormData());
  expect(sent).toEqual(["in place to conversation 7", "to conversation 7"]);
});

test("anyone else sees the note instead of the form", () => {
  const html = draw({ isLocked: true, canReply: false });
  expect(html).toContain(NOTE);
  expect(html).not.toContain("reply-form");
});

test("a member who may not reply to an open conversation gets the plain refusal", () => {
  const html = draw({ canReply: false });
  expect(html).toContain("You cannot reply to this direct message.");
  expect(html).not.toContain(NOTE);
});
