"use server";

import {
  approvalsViewConversationMessage,
  moderationSetState,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { formFailure, text } from "../../../../admin/groups/form-errors";
import type { AuditedState } from "../../../audited-state";
import { APPROVAL_TYPES } from "../../../content";
import { ConversationContext } from "../../../conversation-context";
import { noticeOf } from "../../../notice-input";

// Approving makes the content visible; rejecting deletes it. Both are the contract's own state
// change, which refuses content the viewer may not approve.
const DECISIONS = { approve: "visible", reject: "deleted" } as const;
const FIELDS = ["reason", "message"];

export async function decideContent(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("moderation.errors");
  const id = parseId(text(formData, "id"));
  if (id === null) return { error: t("id") };
  const type = APPROVAL_TYPES.find(
    (option) => option === text(formData, "type"),
  );
  if (!type) return { error: t("type") };
  const decision = (Object.keys(DECISIONS) as (keyof typeof DECISIONS)[]).find(
    (option) => option === text(formData, "decision"),
  );
  if (!decision) return { error: t("decision") };
  try {
    await call(moderationSetState, {
      target: { type, id },
      state: DECISIONS[decision],
      ...noticeOf(formData),
    });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(
    `/moderation/approvals?notice=${decision === "approve" ? "approved" : "rejected"}`,
  );
}

// The audited preview of a conversation message waiting for approval. The only place the read is
// made, once per post: the moderator log gets one entry per confirmed view.
export async function viewApprovalMessage(
  _previous: AuditedState,
  formData: FormData,
): Promise<AuditedState> {
  const t = await getTranslations("moderation.errors");
  const messageId = parseId(text(formData, "id"));
  if (messageId === null) return { error: t("id") };
  const result = await attempt(
    `/moderation/approvals/conversation_message/${messageId}`,
    () => call(approvalsViewConversationMessage, { messageId }),
  );
  if (!result.ok) return { error: result.error };
  const { title, messages } = result.value;
  return {
    view: (
      <ConversationContext
        title={title}
        messages={messages.map((message) => ({
          id: message.id,
          author: message.author,
          bodyHtml: message.bodyHtml,
          createdAt: message.createdAt,
          target: message.isTarget,
        }))}
      />
    ),
  };
}
