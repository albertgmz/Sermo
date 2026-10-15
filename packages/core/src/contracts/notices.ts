import * as z from "zod";
import { defineContract } from "../operation";
import { Body, Empty, Id, Ok, Timestamp, Title } from "./common";
import { CriteriaRule } from "./criteria";

const NoticeFields = {
  title: Title,
  body: Body,
  /** Who sees it; no conditions = everyone. Only `cheap` criteria: it is checked on each request. */
  rule: CriteriaRule,
  dismissible: z.boolean(),
  active: z.boolean(),
  startsAt: Timestamp.nullable(),
  endsAt: Timestamp.nullable(),
};

/** What a visitor is shown. */
export const Notice = z
  .object({ id: Id, title: z.string(), bodyHtml: z.string(), dismissible: z.boolean() })
  .meta({ id: "Notice" });

export const NoticeDetail = z
  .object({
    id: Id,
    title: z.string(),
    bodySource: z.string(),
    bodyHtml: z.string(),
    rule: CriteriaRule,
    dismissible: z.boolean(),
    active: z.boolean(),
    startsAt: Timestamp.nullable(),
    endsAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "NoticeDetail" });

export const noticesCurrent = defineContract({
  name: "notices.current",
  summary:
    "The notices shown to the viewer now, newest first: active, inside their dates, whose rule " +
    "holds for the viewer (guests, members, a group, listed members, ...), less those a member " +
    "dismissed. Open to everyone; guests keep their dismissals in the browser.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Notice) }),
});

export const noticesDismiss = defineContract({
  name: "notices.dismiss",
  summary:
    "Hide a dismissible notice for the signed-in member. Repeating it is harmless; a notice " +
    "that is not dismissible, or not shown to the member, is not found.",
  kind: "write",
  input: z.object({ noticeId: Id }),
  output: Ok,
});

export const noticesList = defineContract({
  name: "notices.list",
  summary: "Every notice, newest first, for the panel. Requires admin.announcements.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(NoticeDetail) }),
});

export const noticesCreate = defineContract({
  name: "notices.create",
  summary:
    "Create a notice. Its rule may only use `cheap` criteria (a validation error otherwise). " +
    "Requires admin.announcements.",
  kind: "write",
  input: z.object(NoticeFields),
  output: NoticeDetail,
});

export const noticesUpdate = defineContract({
  name: "notices.update",
  summary:
    "Change a notice; every field is replaced. Editing does not bring it back for members who " +
    "dismissed it. Requires admin.announcements.",
  kind: "write",
  input: z.object({ noticeId: Id, ...NoticeFields }),
  output: NoticeDetail,
});

export const noticesDelete = defineContract({
  name: "notices.delete",
  summary: "Delete a notice and its dismissals. Requires admin.announcements.",
  kind: "write",
  input: z.object({ noticeId: Id }),
  output: Ok,
});
