import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ContentActions } from "@/components/forum/content-actions";
import { DeletedToggle } from "@/components/forum/deleted-item";
import { PostNote } from "@/components/forum/post-frame";
import { RelativeTime } from "@/components/forum/relative-time";
import { cn } from "@/lib/utils";

// Who deleted an item, when and why (a `PostDeletion` of the backend).
export type Deletion = {
  by: { username: string } | { kind: "guest"; name: string | null };
  reason: string;
  at: string;
};

const dot = <span aria-hidden="true"> · </span>;

// The line a deleted item carries for the staff who see it, as XenForo's deletion notice: "Deleted
// by X · when · Reason: Y" (`fallback` where no record says who), then "Show…" or "Hide" inside a
// `DeletedItem`; beside it, what the viewer may do to the item (`tools`: restore it, delete it for
// good), on the folded line and on the open item alike.
export function DeletionNotice({
  deletion,
  fallback,
  tools,
  className,
}: {
  deletion: Deletion | null;
  fallback: string;
  tools?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("forum.deletionNotice");
  const guest = useTranslations("forum.guestAuthor");
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1",
        className,
      )}
    >
      <PostNote icon={Trash2} className="mt-0 min-w-0 flex-1 basis-60">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {deletion ? (
            <>
              {t("by", {
                name:
                  "username" in deletion.by
                    ? deletion.by.username
                    : (deletion.by.name ?? guest("label")),
              })}
              {dot}
              <RelativeTime date={deletion.at} />
              {deletion.reason && (
                <>
                  {dot}
                  {t("reason", { reason: deletion.reason })}
                </>
              )}
            </>
          ) : (
            fallback
          )}{" "}
          <DeletedToggle show={t("show")} hide={t("hide")} />
        </span>
      </PostNote>
      {tools}
    </div>
  );
}

// What a deletion notice offers beside it (its `tools`): restoring the item (`moderation`) and
// deleting it for good (`remove`), drawn as the item's footer draws them; nothing when the viewer
// may do neither.
export function DeletionTools({
  remove,
  moderation,
}: {
  remove?: React.ComponentProps<typeof ContentActions>["remove"];
  moderation?: React.ReactNode;
}) {
  if (!remove && !moderation) return null;
  return (
    <ContentActions
      layout="split"
      remove={remove}
      moderation={moderation}
      className="mt-0"
    />
  );
}
