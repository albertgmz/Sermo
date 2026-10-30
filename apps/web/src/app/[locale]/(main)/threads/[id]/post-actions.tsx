import { useTranslations } from "next-intl";
import { reportContent } from "@/app/[locale]/(main)/actions";
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
import { deleteMode } from "@/components/forum/delete-mode";
import { DeletionTools } from "@/components/forum/deletion-notice";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import { memberIdOf } from "@/lib/sermo/authors";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import type { ApiPost } from "@/lib/sermo/threads";

// The footer of a post in a thread, laid out as XenForo's: report, edit, delete and the moderator
// tools on the left; react, "+ Quote" on the right; who reacted under it. Share and
// bookmark sit in the post's header row (`PostItem`). Edit, delete and report are the backend's
// word for the viewer (`canEdit`, `canDelete`, `canReport`), and as on XenForo nobody reports their
// own post; quoting needs the right to reply, and a deleted post is not quoted.
// A deleted post's restore and delete sit on its deletion notice instead (`part`: "tools" there,
// "footer" for the rest).
export function PostActions({
  post,
  viewerId,
  picker,
  reactionTypes,
  may,
  noteState,
  canQuote,
  viewList,
  part,
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
  viewList?: boolean;
  // Only the restore and delete ("tools"), or all but them ("footer"); all when left out.
  part?: "tools" | "footer";
}) {
  const t = useTranslations("threads.page");
  const actions = useTranslations("forum.contentActions");
  const reactions = {
    target: "post" as const,
    id: post.id,
    reactions: post.reactions,
    authorId: memberIdOf(post.author),
    viewerId,
    picker,
    reactionTypes,
    viewList,
  };
  const live = viewerId !== null && post.state !== "deleted";
  const removal = deleteMode(post, may.hardDeleteAny);
  const remove =
    viewerId !== null && removal.show
      ? {
          action: deletePostAction.bind(null, post.threadId, post.id),
          permanent: removal.permanent,
          warning: actions("deleteWarning"),
          permanentHint: actions("hardDeletePostWarning"),
        }
      : undefined;
  const moderation = noteState && mayRestore(may, post.state) && (
    <ActionForm
      action={restorePostAction.bind(null, post.threadId, post.id)}
      submit={post.state === "moderated" ? t("approve") : t("restore")}
    />
  );
  if (part === "tools")
    return <DeletionTools remove={remove} moderation={moderation} />;
  const tools = part !== "footer";
  return (
    <ContentActions
      layout="split"
      summary={<Reactions {...reactions} part="summary" />}
      react={<Reactions {...reactions} part="button" />}
      quote={
        canQuote && post.state === "visible"
          ? { postId: post.id, event: QUOTE_EVENT, load: quoteSource }
          : undefined
      }
      edit={
        post.canEdit
          ? { href: `/threads/${post.threadId}/edit/${post.id}` }
          : undefined
      }
      remove={tools ? remove : undefined}
      report={
        live && post.canReport && viewerId !== memberIdOf(post.author)
          ? { action: reportContent.bind(null, "post", post.id) }
          : undefined
      }
      moderation={tools && moderation}
    />
  );
}
