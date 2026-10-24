"use server";

import { reportsViewConversationMessage } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { text } from "../../../../admin/groups/form-errors";
import type { AuditedState } from "../../../audited-state";
import { ConversationContext } from "../../../conversation-context";

// The audited view of a reported private message. This action is the only place the read is
// made, once per post, so the moderator log gets one entry per confirmed view.
export async function viewReportedMessage(
  _previous: AuditedState,
  formData: FormData,
): Promise<AuditedState> {
  const t = await getTranslations("moderation.errors");
  const groupId = parseId(text(formData, "id"));
  if (groupId === null) return { error: t("id") };
  const result = await attempt(`/moderation/reports/${groupId}/message`, () =>
    call(reportsViewConversationMessage, { groupId }),
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
          target: message.reported,
        }))}
      />
    ),
  };
}
