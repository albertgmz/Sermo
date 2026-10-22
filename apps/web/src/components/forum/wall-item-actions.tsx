import { useTranslations } from "next-intl";
import { reportContent } from "@/app/[locale]/(main)/actions";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import {
  deleteWallItem,
  editWallItem,
  hardDeleteWallPost,
  wallItemSource,
} from "@/app/[locale]/(main)/members/actions";
import { ContentActions } from "@/components/forum/content-actions";
import { ContentMenu } from "@/components/forum/content-menu";
import { DeleteControl } from "@/components/forum/delete-control";
import { EditedMark } from "@/components/forum/edited-mark";
import { InlineEditForm } from "@/components/forum/inline-edit-form";
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
// (`summary` false).
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
  summary = true,
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
  // Deleting a deleted wall post for good (`profilePost.hardDelete`).
  mayHardDelete?: boolean;
  // Whether who reacted is drawn under the bar.
  summary?: boolean;
}) {
  const t = useTranslations("forum.contentActions");
  const isComment = kind === "comment";
  const reactions = { kind, item, viewerId, picker, reactionTypes, viewList };
  const live = item.state !== "deleted";
  return (
    <ContentActions
      layout="wall"
      menu={<ContentMenu className={messageActionClass} />}
      leading={
        isComment && (
          <span className="inline-flex h-10 items-center px-2 text-xs whitespace-nowrap text-muted-foreground md:h-8">
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
                <InlineEditForm
                  load={wallItemSource.bind(null, kind, item.id)}
                  action={editWallItem.bind(null, kind, item.id)}
                  placeholder={t("editPlaceholder")}
                  target={`#profile-${kind === "post" ? "post" : "comment"}-${item.id}`}
                />
              ),
            }
          : undefined
      }
      remove={
        item.canDelete && live
          ? {
              action: deleteWallItem.bind(null, kind, item.id),
              warning: t("deleteWarning"),
            }
          : undefined
      }
      moderation={
        mayHardDelete &&
        kind === "post" &&
        item.state === "deleted" && (
          <DeleteControl
            action={hardDeleteWallPost.bind(null, item.id)}
            label={t("hardDelete")}
            confirm={t("hardDeleteConfirm")}
            cancel={t("cancel")}
            reasonLabel={t("deleteReason")}
            warning={t("hardDeleteWallWarning")}
          />
        )
      }
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
