import { type Actor, actorUserId } from "../../actor";
import { markPublic } from "../../operation";

export type Notice = { notify: boolean; message?: string; reason: string };

/** Content events carry moderation notice details only when someone acts on another author. */
export const noticeForOther = markPublic(
  "Callers authorize the content action before adding notice details.",
  function noticeForOther(actor: Actor, authorId: number, input: Notice) {
    return actorUserId(actor) === authorId
      ? {}
      : {
          actorId: actorUserId(actor),
          reason: input.reason,
          notify: input.notify,
          message: input.message,
        };
  },
);
