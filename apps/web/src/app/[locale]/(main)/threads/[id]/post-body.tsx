import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { HtmlContent } from "@/components/forum/html-content";
import type { quotable } from "@/components/forum/selection-bb";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import type { ApiPost } from "@/lib/sermo/threads";

// The text of a post (or of a conversation message, `type`) and its files, on the page and as an
// edit made in place answers with it. `quote` makes the text quotable by selection (`quotable`),
// for a viewer who may quote it.
export function PostBody({
  post,
  type = "post",
  className,
  quote,
}: {
  post: Pick<ApiPost, "id" | "bodyHtml" | "attachments">;
  type?: "post" | "conversation_message";
  className?: string;
  quote?: ReturnType<typeof quotable>;
}) {
  return (
    <>
      <div {...quote}>
        <HtmlContent
          className={className}
          content={{ type, id: post.id }}
          attachments={post.attachments}
        >
          {post.bodyHtml}
        </HtmlContent>
      </div>
      <PostAttachments
        attachments={post.attachments}
        inline={inlineAttachmentIds(post.bodyHtml, post.attachments)}
      />
    </>
  );
}
