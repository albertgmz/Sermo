import { MessageCircle, PenLine } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { react } from "@/app/(main)/actions";
import { commentOnWallPost, postToWall } from "@/app/(main)/members/actions";
import { ClientIcons } from "@/components/forum/client-icons";
import { CompactComposer } from "@/components/forum/compact-composer";
import { EmptyState } from "@/components/forum/empty-state";
import {
  MessageBody,
  MessageRow,
  messageActionClass,
} from "@/components/forum/message-row";
import { ReactionButton } from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserLink } from "@/components/forum/user-link";
import { buttonVariants } from "@/components/ui/button";
import type { ProfilePostView, UserView } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import type { ReactionType } from "@/lib/types";
import { cn } from "@/lib/utils";

function WallPost({
  post,
  viewer,
  reactionTypes,
}: {
  post: ProfilePostView;
  viewer: UserView | null;
  reactionTypes: ReactionType[];
}) {
  const t = useTranslations("members.wall");
  const anchor = `profile-post-${post.id}`;
  return (
    <MessageRow
      id={anchor}
      author={post.author.member}
      time={
        <>
          <RelativeTime date={post.createdAt} />{" "}
          <ClientIcons client={post.client} className="ml-1" />
        </>
      }
      actions={
        <>
          <ReactionButton
            action={react.bind(null, "profilePost", post.id)}
            total={post.reactions.total}
            viewerTypeId={post.reactions.viewerTypeId}
            types={reactionTypes}
            viewerId={viewer?.id ?? null}
            authorId={post.authorId}
          />
          <Link
            href={viewer ? `#${anchor}-comment` : "/login"}
            aria-label={t("aria.comments", { count: post.comments.length })}
            className={messageActionClass}
          >
            <MessageCircle />
            {formatNumber(post.comments.length)}
          </Link>
          <ReactionSummary reactions={post.reactions} className="ml-auto" />
        </>
      }
      footer={
        (post.comments.length > 0 || viewer) && (
          <div className="mt-2 space-y-3 border-l pl-3">
            {post.comments.map((comment) => (
              <MessageRow
                key={comment.id}
                compact
                author={comment.author.member}
                time={
                  <>
                    <RelativeTime date={comment.createdAt} />{" "}
                    <ClientIcons client={comment.client} className="ml-1" />
                  </>
                }
                actions={
                  <>
                    <ReactionButton
                      action={react.bind(null, "profileComment", comment.id)}
                      total={comment.reactions.total}
                      viewerTypeId={comment.reactions.viewerTypeId}
                      types={reactionTypes}
                      viewerId={viewer?.id ?? null}
                      authorId={comment.authorId}
                      size="sm"
                      className="-my-1.5 md:my-0"
                    />
                    <ReactionSummary reactions={comment.reactions} size="sm" />
                  </>
                }
              >
                <MessageBody className="text-(length:--text-compact)">
                  {comment.body}
                </MessageBody>
              </MessageRow>
            ))}
            {viewer && (
              <div id={`${anchor}-comment`} className="scroll-mt-24">
                <CompactComposer
                  action={commentOnWallPost.bind(
                    null,
                    post.profileUserId,
                    post.id,
                  )}
                  placeholder={t("commentPlaceholder")}
                  submitLabel={t("commentSubmit")}
                />
              </div>
            )}
          </div>
        )
      }
    >
      <MessageBody>{post.body}</MessageBody>
    </MessageRow>
  );
}

export function Wall({
  user,
  viewer,
  posts,
  reactionTypes,
}: {
  user: UserView;
  viewer: UserView | null;
  posts: ProfilePostView[];
  reactionTypes: ReactionType[];
}) {
  const t = useTranslations("members.wall");
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="sr-only">{t("heading")}</h2>
      {viewer && (
        <CompactComposer
          action={postToWall.bind(null, user.id)}
          user={viewer.member}
          placeholder={t("placeholder", { username: user.username })}
          submitLabel={t("submit")}
          className="border-b p-4"
        />
      )}
      {posts.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title={t("emptyTitle")}
          description={t.rich("emptyDescription", {
            username: user.username,
            user: () => <UserLink user={user.member} />,
          })}
        >
          {!viewer && (
            <Link href="/login" className={cn(buttonVariants(), "h-10 px-4")}>
              {t("login")}
            </Link>
          )}
        </EmptyState>
      ) : (
        <div className="divide-y divide-border">
          {posts.map((post) => (
            <WallPost
              key={post.id}
              post={post}
              viewer={viewer}
              reactionTypes={reactionTypes}
            />
          ))}
        </div>
      )}
    </section>
  );
}
