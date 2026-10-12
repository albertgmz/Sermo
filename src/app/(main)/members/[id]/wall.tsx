import { MessageCircle, PenLine } from "lucide-react";
import Link from "next/link";
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
  const anchor = `profile-post-${post.id}`;
  return (
    <MessageRow
      id={anchor}
      author={post.author}
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
            aria-label={`Comment, ${post.comments.length} ${post.comments.length === 1 ? "comment" : "comments"}`}
            className={messageActionClass}
          >
            <MessageCircle />
            {post.comments.length}
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
                author={comment.author}
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
                  placeholder="Write a comment…"
                  submitLabel="Post comment"
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
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="sr-only">Wall</h2>
      {viewer && (
        <CompactComposer
          action={postToWall.bind(null, user.id)}
          user={viewer}
          placeholder={`Write something on ${user.username}'s profile…`}
          submitLabel="Post"
          className="border-b p-4"
        />
      )}
      {posts.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="No messages yet"
          description={
            <>
              Be the first to write something on <UserLink user={user} />
              's profile.
            </>
          }
        >
          {!viewer && (
            <Link href="/login" className={cn(buttonVariants(), "h-10 px-4")}>
              Log in to post
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
