import { threadsGet } from "@sermo/core/contracts";
import { Hourglass, PenLine, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SPLIT_FORM } from "@/app/[locale]/(main)/threads/[id]/moderation";
import { isNewPost } from "@/app/[locale]/(main)/threads/[id]/new-posts";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import {
  type ThreadMay,
  threadMay,
} from "@/app/[locale]/(main)/threads/[id]/permissions";
import { PostActions } from "@/app/[locale]/(main)/threads/[id]/post-actions";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import {
  EditablePostBody,
  EditedStamp,
  PostEditScope,
} from "@/app/[locale]/(main)/threads/[id]/post-edit-scope";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { EditedMark } from "@/components/forum/edited-mark";
import { HtmlContent } from "@/components/forum/html-content";
import { attributionGadgetClass } from "@/components/forum/message-action";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import type { ReactionType } from "@/components/forum/reaction-button";
import { quotable } from "@/components/forum/selection-bb";
import { ShareButton } from "@/components/forum/share-button";
import { HashLink } from "@/components/layout/hash-link";
import { Badge } from "@/components/ui/badge";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import { bookmarkedAmong } from "@/lib/sermo/bookmarks";
import { call } from "@/lib/sermo/client";
import { authorsFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import type { ApiPost } from "@/lib/sermo/threads";
import type { AuthorView } from "@/lib/sermo/views";
import type { TailRow } from "@/lib/tail";

const LABEL = "sr-only sm:not-sr-only";

// One post of a thread as it is drawn in the list, on the page and in what is added to the last
// page while it is open. Its header row reads as XenForo's: the time on the left; on the right the
// highlighted and thread-author marks, "New", share, bookmark and the post number.
export function PostItem({
  post,
  author,
  byThreadAuthor,
  noteState,
  highlighted,
  signed,
  viewerId,
  picker,
  reactionTypes,
  may,
  isFirst,
  selecting,
  canQuote,
  bookmarked,
  isNew,
  viewList,
}: {
  post: ApiPost;
  author: AuthorView;
  byThreadAuthor: boolean;
  // Whether the post says it is waiting or deleted; the thread says so already for its own state.
  noteState: boolean;
  highlighted: boolean;
  signed: boolean;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react to this post.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  may: ThreadMay;
  // The opening post cannot be deleted or split off on its own.
  isFirst: boolean;
  // The posts carry a tick for the split form.
  selecting: boolean;
  canQuote: boolean;
  // Null for a guest or when the state could not be read: no toggle is drawn.
  bookmarked: boolean | null;
  // After the viewer's read position (`isNewPost`).
  isNew: boolean;
  viewList?: boolean;
}) {
  const t = useTranslations("threads.page");
  const number = post.position + 1;
  const href = threadHref(post.threadId, post.position, post.id);
  // Its Edit opens the editor in place of the text (a deleted post's goes to the edit page).
  const inPlace = post.canEdit && post.state !== "deleted";
  const edited = post.editedAt && <EditedMark date={post.editedAt} />;
  // What a selection inside the text needs to quote only that part (`SelectionQuote`).
  const quote =
    canQuote && post.state === "visible"
      ? quotable("post", post.id, post.author)
      : undefined;

  const frame = (
    <PostFrame
      id={`post-${post.id}`}
      author={author}
      createdAt={post.createdAt}
      highlighted={highlighted}
      edited={
        inPlace ? <EditedStamp postId={post.id}>{edited}</EditedStamp> : edited
      }
      trailing={
        <>
          {/* On a phone the two marks are icons, their words for screen readers only, so the
              row keeps room for the time. */}
          {highlighted && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium text-primary-ink">
              <Sparkles aria-hidden="true" className="size-3 shrink-0" />
              <span className={LABEL}>{t("highlightedLabel")}</span>
            </span>
          )}
          {byThreadAuthor && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium">
              <PenLine aria-hidden="true" className="size-3 shrink-0" />
              <span className={LABEL}>
                {t.rich("authorLabel", {
                  hidden: (chunks) => <span className="sr-only">{chunks}</span>,
                })}
              </span>
            </span>
          )}
          {isNew && <Badge className="mr-1">{t("newBadge")}</Badge>}
          {post.state !== "deleted" && (
            <ShareButton href={href} className={attributionGadgetClass} />
          )}
          {bookmarked !== null && (
            <BookmarkButton
              contentType="post"
              contentId={post.id}
              bookmarked={bookmarked}
              className={attributionGadgetClass}
              labelClassName="hidden"
              floatingError
            />
          )}
          <HashLink
            href={href}
            className={`${attributionGadgetClass} tabular-nums`}
          >
            {t("postNumber", { number })}
          </HashLink>
        </>
      }
      signed={signed}
      actions={
        <PostActions
          post={post}
          viewerId={viewerId}
          picker={picker}
          reactionTypes={reactionTypes}
          may={may}
          noteState={noteState}
          canQuote={canQuote}
          viewList={viewList}
        />
      }
    >
      {/* The first post cannot be split off: a hint that copies the backend's threads.split rule,
            whose refusal is shown under the split form if the hint is ever wrong. */}
      {selecting && !isFirst && (
        <label className="mt-1 flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="postIds"
            value={post.id}
            form={SPLIT_FORM}
            className="size-5 accent-primary"
          />
          {t("selectPost", { number })}
        </label>
      )}

      {noteState && post.state === "moderated" && (
        <PostNote icon={Hourglass}>{t("awaitingApproval")}</PostNote>
      )}
      {noteState && post.state === "deleted" && (
        <PostNote icon={Trash2}>
          {post.deletion ? (
            <span>
              {t("deletedBy", { name: post.deletion.by.username })}
              {post.deletion.reason &&
                ` ${t("deletedReason", { reason: post.deletion.reason })}`}
            </span>
          ) : (
            t("deleted")
          )}
        </PostNote>
      )}
      {post.state === "deleted" ? (
        <details className="mt-2">
          <summary className="flex min-h-10 cursor-pointer items-center text-sm text-muted-foreground">
            {t("showDeleted")}
          </summary>
          <PostBody post={post} />
        </details>
      ) : inPlace ? (
        <EditablePostBody postId={post.id} canQuote={quote !== undefined}>
          <PostBody post={post} className="md:mt-1" quote={quote} />
        </EditablePostBody>
      ) : (
        <PostBody post={post} className="md:mt-1" quote={quote} />
      )}
    </PostFrame>
  );
  return inPlace ? (
    <PostEditScope threadId={post.threadId} postId={post.id}>
      {frame}
    </PostEditScope>
  ) : (
    frame
  );
}

// The text of a post and its files, on the page and as an edit made in place answers with it.
// `quote` makes the text quotable by selection (`quotable`), for a viewer who may quote it.
export function PostBody({
  post,
  className,
  quote,
}: {
  post: Pick<ApiPost, "id" | "bodyHtml" | "attachments">;
  className?: string;
  quote?: ReturnType<typeof quotable>;
}) {
  return (
    <>
      <div {...quote}>
        <HtmlContent
          className={className}
          content={{ type: "post", id: post.id }}
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

// Posts that came after the last page was drawn, drawn the way the page draws them. They are all
// of one thread, whose author and what the viewer may do in it are read here (without counting a
// view), never taken from the browser. A signature stays under the author's first post on the
// page, so none is drawn here.
export async function postRows(posts: ApiPost[]): Promise<TailRow[]> {
  if (posts.length === 0) return [];
  const [
    { user, permissions, resolvedPermissions: viewerCan },
    reactionTypes,
    found,
  ] = await Promise.all([
    getViewer(),
    getReactionTypes(),
    call(threadsGet, { threadId: posts[0].threadId, countView: false }),
  ]);
  const context = {
    threadAuthorId: found.thread.author.id,
    may: threadMay(found.resolvedPermissions, found.permissions),
    canQuote: found.permissions.canReply,
  };
  const [author, bookmarks] = await Promise.all([
    authorsFor(posts.map((post) => post.author)),
    user
      ? bookmarkedAmong(
          "post",
          posts.map((post) => post.id),
        )
      : null,
  ]);
  const picker =
    permissions.canReact && found.resolvedPermissions["forum.react"] !== false
      ? pickerTypes(reactionTypes, found.thread.node.id)
      : [];
  // Read now: the poll marks the thread read only after drawing what arrived, and a reply of the
  // viewer's own has moved their read position past it already.
  const viewer = {
    signedIn: user !== null,
    readPosition: found.thread.readPosition,
  };
  const now = Date.now();
  return posts.map((post) => ({
    key: `post-${post.id}`,
    id: post.id,
    mark: post.position,
    node: (
      <PostItem
        post={post}
        author={author(post.author.id)}
        byThreadAuthor={post.author.id === context.threadAuthorId}
        noteState={post.state !== "visible"}
        highlighted={false}
        signed={false}
        viewerId={user?.id ?? null}
        picker={post.state === "visible" ? picker : []}
        reactionTypes={reactionTypes}
        viewList={viewerCan["reaction.viewList"] !== false}
        may={context.may}
        isFirst={false}
        selecting={false}
        canQuote={context.canQuote}
        bookmarked={bookmarks ? bookmarks.toggle(post.id) : null}
        isNew={isNewPost(post, viewer, now)}
      />
    ),
  }));
}
