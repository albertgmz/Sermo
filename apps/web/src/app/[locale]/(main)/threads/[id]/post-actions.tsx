import { useTranslations } from "next-intl";
import { reportContent } from "@/app/[locale]/(main)/actions";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import {
  mayRestore,
  type ThreadMay,
} from "@/app/[locale]/(main)/threads/[id]/permissions";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import {
  deletePostAction,
  quoteSource,
  restorePostAction,
} from "@/app/[locale]/(main)/threads/actions";
import { ActionForm } from "@/components/forum/action-form";
import { ContentActions } from "@/components/forum/content-actions";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import type { ApiPost } from "@/lib/sermo/threads";

// The footer of a post in a thread. Edit, delete and report are the backend's word for the viewer
// (`canEdit`, `canDelete`, `canReport`); quoting needs the right to reply.
export function PostActions({
  post,
  viewerId,
  picker,
  reactionTypes,
  may,
  noteState,
  canQuote,
}: {
  post: ApiPost;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react to this post.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  may: ThreadMay;
  // Whether the post says it is waiting or deleted (the moderator can approve or restore it).
  noteState: boolean;
  canQuote: boolean;
}) {
  const t = useTranslations("threads.page");
  const reactions = {
    target: "post" as const,
    id: post.id,
    reactions: post.reactions,
    authorId: post.author.id,
    viewerId,
    picker,
    reactionTypes,
  };
  const live = viewerId !== null && post.state !== "deleted";
  return (
    <ContentActions
      summary={<Reactions {...reactions} part="summary" />}
      react={<Reactions {...reactions} part="button" />}
      quote={
        canQuote && post.state === "visible"
          ? { postId: post.id, event: QUOTE_EVENT, load: quoteSource }
          : undefined
      }
      reply={{ href: "#reply" }}
      share={
        post.state === "deleted"
          ? undefined
          : threadHref(post.threadId, post.position, post.id)
      }
      edit={
        post.canEdit
          ? { href: `/threads/${post.threadId}/edit/${post.id}` }
          : undefined
      }
      remove={
        live && post.canDelete
          ? {
              action: deletePostAction.bind(null, post.threadId, post.id),
              withReason: true,
            }
          : undefined
      }
      report={
        live && post.canReport
          ? { action: reportContent.bind(null, "post", post.id) }
          : undefined
      }
      moderation={
        noteState &&
        mayRestore(may, post.state) && (
          <ActionForm
            action={restorePostAction.bind(null, post.threadId, post.id)}
            submit={post.state === "moderated" ? t("approve") : t("restore")}
          />
        )
      }
    />
  );
}
