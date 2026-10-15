import { threadsGet } from "@sermo/core/contracts";
import { Hourglass, PenLine, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SPLIT_FORM } from "@/app/[locale]/(main)/threads/[id]/moderation";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import {
  type ThreadMay,
  threadMay,
} from "@/app/[locale]/(main)/threads/[id]/permissions";
import { PostActions } from "@/app/[locale]/(main)/threads/[id]/post-actions";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { EditedMark } from "@/components/forum/edited-mark";
import { HtmlContent } from "@/components/forum/html-content";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import type { ReactionType } from "@/components/forum/reaction-button";
import { HashLink } from "@/components/layout/hash-link";
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
// page while it is open.
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
  bookmarked: boolean | null;
}) {
  const t = useTranslations("threads.page");
  const number = post.position + 1;
  const href = threadHref(post.threadId, post.position, post.id);

  return (
    <PostFrame
      id={`post-${post.id}`}
      author={author}
      createdAt={post.createdAt}
      highlighted={highlighted}
      edited={post.editedAt && <EditedMark date={post.editedAt} />}
      trailing={
        <>
          {highlighted && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium text-primary-ink">
              <Sparkles aria-hidden="true" className="size-3" />
              <span className={LABEL}>{t("highlightedLabel")}</span>
            </span>
          )}
          {byThreadAuthor && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium">
              <PenLine aria-hidden="true" className="hidden size-3 sm:block" />
              {t.rich("authorLabel", {
                hidden: (chunks) => <span className="sr-only">{chunks}</span>,
              })}
            </span>
          )}
          <HashLink
            href={href}
            className="inline-flex h-10 min-w-10 items-center justify-center px-1.5 tabular-nums hover:text-foreground md:h-7 md:min-w-7"
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
          bookmarked={bookmarked}
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
        <PostNote icon={Trash2}>{t("deleted")}</PostNote>
      )}
      {post.state === "deleted" ? (
        <details className="mt-2">
          <summary className="flex min-h-10 cursor-pointer items-center text-sm text-muted-foreground">
            {t("showDeleted")}
          </summary>
          <HtmlContent
            content={{ type: "post", id: post.id }}
            attachments={post.attachments}
          >
            {post.bodyHtml}
          </HtmlContent>
          <PostAttachments
            attachments={post.attachments}
            inline={inlineAttachmentIds(post.bodyHtml, post.attachments)}
          />
        </details>
      ) : (
        <>
          <HtmlContent
            className="md:mt-1"
            content={{ type: "post", id: post.id }}
            attachments={post.attachments}
          >
            {post.bodyHtml}
          </HtmlContent>
          <PostAttachments
            attachments={post.attachments}
            inline={inlineAttachmentIds(post.bodyHtml, post.attachments)}
          />
        </>
      )}
    </PostFrame>
  );
}

// Posts that came after the last page was drawn, drawn the way the page draws them. They are all
// of one thread, whose author and what the viewer may do in it are read here (without counting a
// view), never taken from the browser. A signature stays under the author's first post on the
// page, so none is drawn here.
export async function postRows(posts: ApiPost[]): Promise<TailRow[]> {
  if (posts.length === 0) return [];
  const [{ user, permissions }, reactionTypes, found] = await Promise.all([
    getViewer(),
    getReactionTypes(),
    call(threadsGet, { threadId: posts[0].threadId, countView: false }),
  ]);
  const context = {
    threadAuthorId: found.thread.author.id,
    may: threadMay(found.resolvedPermissions),
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
  const picker = permissions.canReact ? pickerTypes(reactionTypes) : [];
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
        may={context.may}
        isFirst={false}
        selecting={false}
        canQuote={context.canQuote}
        bookmarked={bookmarks ? bookmarks.has(post.id) : null}
      />
    ),
  }));
}
