import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { HtmlContent } from "@/components/forum/html-content";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import { spoilerContentFor } from "@/lib/spoiler-buttons";
import type { Described, TargetType } from "./content";

// The text of a reported or queued item and the files attached to it, as they show in the forum:
// the ones the text places inline sit in it, the others are listed under it.
export function ContentBody({
  type,
  id,
  html,
  attachments,
}: {
  type: TargetType;
  id: number;
  html: string;
  attachments: Described["attachments"];
}) {
  return (
    <>
      <HtmlContent
        content={spoilerContentFor(type, id)}
        attachments={attachments}
      >
        {html}
      </HtmlContent>
      <PostAttachments
        attachments={attachments}
        inline={inlineAttachmentIds(html, attachments)}
      />
    </>
  );
}
