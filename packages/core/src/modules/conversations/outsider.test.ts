import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { reactionsListOp, reactionsSetOp, reactionTypesCreateOp } from "../reactions/index";
import { spoilersGetOp } from "../spoilers/index";
import {
  conversationsCreateOp,
  conversationsDeleteMessageOp,
  conversationsGetMessageOp,
  conversationsGetOp,
  conversationsHardDeleteMessageOp,
  conversationsListMessagesOp,
  conversationsLocateMessageOp,
  conversationsQuoteMessageOp,
  conversationsReplyOp,
  conversationsUpdateMessageOp,
} from "./index";

// A conversation message is drawn, quoted, edited, deleted and reacted to with a thread post's
// interface; every path the page and its editors reach answers a member outside the conversation
// (an ordinary one, a moderator, an administrator) not found, as if it did not exist.
test("a member outside the conversation gets nothing from any path a message is reached by", async () => {
  const ctx = createTestContext();
  const aUser = insertUser(ctx);
  const bUser = insertUser(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const outsiders = [userActor(insertUser(ctx)), userActor(insertUser(ctx, { groupId: 3 })), admin];
  const a = userActor(aUser);
  const made = await execute(ctx, conversationsCreateOp, a, {
    title: "Private",
    recipientIds: [bUser.id],
    body: "first [SPOILER]secret[/SPOILER]",
  });
  const conversationId = made.conversation.id;
  const reply = await execute(ctx, conversationsReplyOp, a, {
    conversationId,
    body: "a reply of mine",
  });
  const type = await execute(ctx, reactionTypesCreateOp, admin, {
    title: "Like",
    emoji: "X",
    score: 1,
    position: 0,
  });
  const messageId = reply.id;
  const paths: [string, (actor: typeof a) => Promise<unknown>][] = [
    ["the conversation", (actor) => execute(ctx, conversationsGetOp, actor, { conversationId })],
    [
      "its messages",
      (actor) => execute(ctx, conversationsListMessagesOp, actor, { conversationId }),
    ],
    [
      "where a message is",
      (actor) => execute(ctx, conversationsLocateMessageOp, actor, { messageId }),
    ],
    [
      "the source to edit",
      (actor) => execute(ctx, conversationsGetMessageOp, actor, { messageId }),
    ],
    [
      "the source to quote",
      (actor) => execute(ctx, conversationsQuoteMessageOp, actor, { messageId }),
    ],
    [
      "the edit",
      (actor) => execute(ctx, conversationsUpdateMessageOp, actor, { messageId, body: "mine" }),
    ],
    [
      "the delete",
      (actor) => execute(ctx, conversationsDeleteMessageOp, actor, { messageId, reason: "" }),
    ],
    [
      "the permanent delete",
      (actor) => execute(ctx, conversationsHardDeleteMessageOp, actor, { messageId, reason: "" }),
    ],
    [
      "a reaction",
      (actor) =>
        execute(ctx, reactionsSetOp, actor, {
          contentType: "conversation_message",
          contentId: messageId,
          reactionTypeId: type.id,
        }),
    ],
    [
      "who reacted",
      (actor) =>
        execute(ctx, reactionsListOp, actor, {
          contentType: "conversation_message",
          contentId: messageId,
        }),
    ],
    [
      "a spoiler",
      (actor) =>
        execute(ctx, spoilersGetOp, actor, {
          contentType: "conversation_message",
          contentId: made.message.id,
          position: 0,
        }),
    ],
  ];
  for (const outsider of outsiders)
    for (const [name, reach] of paths)
      await expect(reach(outsider), name).rejects.toBeInstanceOf(NotFoundError);
  // Nothing was changed by the attempts: the message is as its author wrote it, unreacted.
  const theirs = await execute(ctx, conversationsGetMessageOp, a, { messageId });
  expect(theirs.bodySource).toBe("a reply of mine");
  expect(theirs.state).toBe("visible");
  expect(theirs.reactions.total).toBe(0);
  // And every path answers a participant: the sweep is not passing on a broken setup.
  const b = userActor(bUser);
  for (const [name, reach] of paths.slice(0, 2))
    await expect(reach(b), name).resolves.toBeDefined();
  await expect(execute(ctx, conversationsQuoteMessageOp, b, { messageId })).resolves.toMatchObject({
    bodySource: "a reply of mine",
  });
});
