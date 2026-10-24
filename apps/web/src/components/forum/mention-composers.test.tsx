import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type Asked,
  fakeBackend,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { Dialog } from "@/components/ui/dialog";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, toString: () => "" }),
}));
// The server actions the forms are bound to.
mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  replyAction: async () => ({}),
  startConversation: async () => ({}),
  findRecipients: async () => [],
}));
mock.module("@/app/[locale]/(main)/conversations/reply-in-place", () => ({
  replyInPlace: async () => ({}),
}));
mock.module("@/app/[locale]/(main)/threads/actions", () => ({
  replyAction: async () => ({}),
}));
mock.module("@/app/[locale]/(main)/threads/reply-in-place", () => ({
  replyInPlace: async () => ({}),
}));
// The editor loads Lexical when it is first used. What matters here is the lookup each composer
// hands it for the list that opens after "@ab", so the stand-in keeps that lookup.
const lookups: Array<(prefix: string) => Promise<unknown>> = [];
mock.module("@/components/forum/lazy-editor", () => ({
  LazyEditor: (props: {
    findMembers?: (prefix: string) => Promise<unknown>;
  }) => {
    if (props.findMembers) lookups.push(props.findMembers);
    return createElement("textarea");
  },
}));

const { ReplyForm } = await import(
  "@/app/[locale]/(main)/conversations/[id]/reply-form"
);
const { NewConversationForm } = await import(
  "@/app/[locale]/(main)/conversations/new/new-conversation-form"
);
const { ReplyComposer } = await import(
  "@/app/[locale]/(main)/threads/[id]/reply-composer"
);
const { WallPostForm } = await import(
  "@/app/[locale]/(main)/members/post-composer"
);
const { LineComposer } = await import("./line-composer");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  backend = undefined;
  lookups.length = 0;
});

const nothing = async () => ({});

const composers: Array<[string, () => React.ReactElement]> = [
  [
    "a thread's reply",
    () =>
      createElement(ReplyComposer, {
        threadId: 3,
        tailKey: "thread:3",
        attachIn: null,
      }),
  ],
  [
    "a conversation's reply",
    () =>
      createElement(ReplyForm, {
        conversationId: 7,
        tailKey: "conversation:7",
        placeholder: "Write a message…",
        submitLabel: "Send message",
      }),
  ],
  ["a new conversation", () => createElement(NewConversationForm)],
  [
    "a wall post",
    () =>
      createElement(
        Dialog,
        { open: true },
        createElement(WallPostForm, {
          action: nothing,
          placeholder: "What's on your mind?",
          name: "ember",
        }),
      ),
  ],
  [
    "a wall post's comment, and a reply from a feed card",
    () =>
      createElement(LineComposer, {
        action: nothing,
        placeholder: "Write a comment…",
        submitLabel: "Comment",
      }),
  ],
];

const members = () =>
  Response.json({
    items: [
      { id: 4, username: "abel", staff: false },
      { id: 5, username: "abby", staff: false },
    ],
  });
const cards = () =>
  Response.json({
    items: [4, 5].map((id) => ({
      id,
      username: id === 4 ? "abel" : "abby",
      avatar: null,
      frame: null,
      nameColor: null,
      nameIcon: null,
      title: "",
      badges: [],
      level: 1,
      restricted: false,
    })),
  });

for (const [name, element] of composers) {
  test(`${name} suggests the members whose name starts with what follows "@ab"`, async () => {
    renderToStaticMarkup(withIntl(element()));
    expect(lookups).toHaveLength(1);
    backend = fakeBackend({ "users.search": members, "users.cards": cards });
    const hits = (await lookups[0]("ab")) as Array<{ username: string }>;
    expect(hits.map((hit) => hit.username)).toEqual(["abel", "abby"]);
    expect(backend.asked.map((entry: Asked) => entry.operation)).toEqual([
      "users.search",
      "users.cards",
    ]);
  });
}

test("a feed card's Reply box is the line composer the wall's comments use", () => {
  const source = readFileSync(
    join(import.meta.dir, "inline-reply.tsx"),
    "utf8",
  );
  expect(source).toContain('import("@/components/forum/line-composer")');
  expect(source).toContain("<LazyLineComposer");
});
