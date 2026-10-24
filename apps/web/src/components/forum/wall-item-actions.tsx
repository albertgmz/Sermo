import { useTranslations } from "next-intl";
import { reportContent } from "@/app/[locale]/(main)/actions";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import {
  deleteWallItem,
  editWallItem,
  restoreWallItem,
  wallItemSource,
} from "@/app/[locale]/(main)/members/actions";
import { ActionForm } from "@/components/forum/action-form";
import { ContentActions } from "@/components/forum/content-actions";
import { ContentMenu } from "@/components/forum/content-menu";
import { deleteMode } from "@/components/forum/delete-mode";
import { DeletionTools } from "@/components/forum/deletion-notice";
import { EditedMark } from "@/components/forum/edited-mark";
import { LazyInlineEditForm } from "@/components/forum/lazy-inline-edit-form";
import { messageActionClass } from "@/components/forum/message-action";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import { RelativeTime } from "@/components/forum/relative-time";
import type { getReactionTypes } from "@/lib/sermo/reactions";

type Item = {
  id: number;
  author: { id: number };
  state: "visible" | "moderated" | "deleted";
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  // Comments only: the viewer may delete a deleted one for good.
  canHardDelete?: boolean;
  canReport: boolean;
  reactions: {
    counts: Record<string, number>;
    total: number;
    mine: number | null;
  };
};

type ReactionsProps = {
  kind: "post" | "comment";
  item: Item;
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  viewList?: boolean;
};

// The reactions of a wall post or comment, one half of them (`part`).
function reactionsOf(
  { kind, item, viewerId, picker, reactionTypes, viewList }: ReactionsProps,
  part: "button" | "summary",
) {
  const isComment = kind === "comment";
  return (
    <Reactions
      target={isComment ? "profileComment" : "profilePost"}
      id={item.id}
      reactions={item.reactions}
      authorId={item.author.id}
      viewerId={viewerId}
      picker={item.state === "visible" ? picker : []}
      reactionTypes={reactionTypes}
      size={isComment ? "sm" : undefined}
      viewList={viewList}
      part={part}
    />
  );
}

// Who reacted to a wall post, for the first row of the block under it (`WallComments`), as
// XenForo puts it.
export function WallItemSummary(props: ReactionsProps) {
  return reactionsOf(props, "summary");
}

// The footer of a wall post or of a comment on one, as XenForo draws them (`ContentActions`
// `layout="wall"`): a comment's date, report, share and the "•••" menu (edit, delete) on the left,
// react on the right, who reacted under it. The same on the profile wall as in the feed. What the
// viewer may edit, delete or report is the backend's word (`canEdit`, `canDelete`, `canReport`);
// editing happens in place. A post's summary goes in the block under it where there is one
// (`summary` false). A deleted item's restore and delete sit on its deletion notice instead
// (`part`: "tools" there, "footer" for the rest).
export function WallItemActions({
  kind,
  item,
  address,
  viewerId,
  picker,
  reactionTypes,
  start,
  viewList,
  mayHardDelete = false,
  mayUndelete = false,
  summary = true,
  part,
}: {
  kind: "post" | "comment";
  item: Item;
  // The wall and the post the item is on, for its permalink.
  address: { profileUserId: number; postId: number };
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  start?: React.ReactNode;
  viewList?: boolean;
  // Deleting a wall post for good (`profilePost.hardDelete`), live or deleted.
  mayHardDelete?: boolean;
  // Bringing a deleted one back (`profilePost.undelete`).
  mayUndelete?: boolean;
  // Whether who reacted is drawn under the bar.
  summary?: boolean;
  // Only the restore and delete ("tools"), or all but them ("footer"); all when left out.
  part?: "tools" | "footer";
}) {
  const t = useTranslations("forum.contentActions");
  const isComment = kind === "comment";
  const reactions = { kind, item, viewerId, picker, reactionTypes, viewList };
  const live = item.state !== "deleted";
  // A comment says it itself; a wall post's right comes from the wall's resolved permissions.
  const hard = isComment ? item.canHardDelete === true : mayHardDelete;
  const removal = deleteMode({ ...item, canHardDelete: hard && !live }, hard);
  const remove = removal.show
    ? {
        action: deleteWallItem.bind(null, kind, item.id),
        permanent: removal.permanent,
        warning: t("deleteWarning"),
        permanentHint: t(
          isComment ? "hardDeleteCommentWarning" : "hardDeleteWallWarning",
        ),
      }
    : undefined;
  const moderation = !live && mayUndelete && (
    <ActionForm
      action={restoreWallItem.bind(null, kind, item.id)}
      submit={t("restore")}
    />
  );
  if (part === "tools")
    return <DeletionTools remove={remove} moderation={moderation} />;
  const tools = part !== "footer";
  return (
    <ContentActions
      layout="wall"
      menu={<ContentMenu className={messageActionClass} />}
      leading={
        isComment && (
          <span className="block min-w-0 text-xs text-muted-foreground max-sm:basis-full max-sm:pt-1 max-sm:leading-5 sm:truncate sm:leading-10 md:leading-8">
            <RelativeTime date={item.createdAt} />
            {item.editedAt && (
              <EditedMark date={item.editedAt} className="ml-1.5" />
            )}
          </span>
        )
      }
      summary={summary && reactionsOf(reactions, "summary")}
      react={reactionsOf(reactions, "button")}
      start={start}
      share={
        item.state === "visible"
          ? wallTargetHref(
              address.profileUserId,
              address.postId,
              isComment ? item.id : undefined,
            )
          : undefined
      }
      edit={
        item.canEdit && live
          ? {
              panel: (
                <LazyInlineEditForm
                  load={wallItemSource.bind(null, kind, item.id)}
                  action={editWallItem.bind(null, kind, item.id)}
                  placeholder={t("editPlaceholder")}
                  target={`#profile-${kind === "post" ? "post" : "comment"}-${item.id}`}
                />
              ),
            }
          : undefined
      }
      remove={tools ? remove : undefined}
      moderation={tools && moderation}
      report={
        item.canReport &&
        viewerId !== null &&
        viewerId !== item.author.id &&
        item.state === "visible"
          ? {
              action: reportContent.bind(
                null,
                isComment ? "profile_post_comment" : "profile_post",
                item.id,
              ),
            }
          : undefined
      }
    />
  );
}
