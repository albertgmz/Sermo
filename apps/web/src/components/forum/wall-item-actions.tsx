import { useTranslations } from "next-intl";
import {
  type ReactionTarget,
  reportContent,
} from "@/app/[locale]/(main)/actions";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import {
  deleteWallItem,
  editWallItem,
  hardDeleteWallPost,
  wallItemSource,
} from "@/app/[locale]/(main)/members/actions";
import { ContentActions } from "@/components/forum/content-actions";
import { DeleteControl } from "@/components/forum/delete-control";
import { InlineEditForm } from "@/components/forum/inline-edit-form";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import type { getReactionTypes } from "@/lib/sermo/reactions";

type Item = {
  id: number;
  author: { id: number };
  state: "visible" | "moderated" | "deleted";
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  reactions: {
    counts: Record<string, number>;
    total: number;
    mine: number | null;
  };
};

// The footer of a wall post or of a comment on one: the same controls on both, and the same on the
// profile wall as in the feed. What the viewer may edit or delete is the backend's word
// (`canEdit`, `canDelete`); editing happens in place.
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
}) {
  const t = useTranslations("forum.contentActions");
  const compact = kind === "comment";
  const target: ReactionTarget = compact ? "profileComment" : "profilePost";
  const reactions = {
    target,
    id: item.id,
    reactions: item.reactions,
    authorId: item.author.id,
    viewerId,
    picker: item.state === "visible" ? picker : [],
    reactionTypes,
    size: compact ? ("sm" as const) : undefined,
    viewList,
  };
  const live = item.state !== "deleted";
  return (
    <ContentActions
      compact={compact}
      summary={<Reactions {...reactions} part="summary" />}
      react={<Reactions {...reactions} part="button" />}
      start={start}
      share={
        item.state === "visible"
          ? wallTargetHref(
              address.profileUserId,
              address.postId,
              compact ? item.id : undefined,
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
        viewerId !== null &&
        viewerId !== item.author.id &&
        item.state === "visible"
          ? {
              action: reportContent.bind(
                null,
                compact ? "profile_post_comment" : "profile_post",
                item.id,
              ),
            }
          : undefined
      }
    />
  );
}
