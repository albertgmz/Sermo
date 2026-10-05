import * as z from "zod";
import { defineContract } from "../operation";
import { Attachment, AttachmentIds } from "./attachments";
import {
  Body,
  ContentState,
  Id,
  Page,
  pageInput,
  ReactionSummary,
  Timestamp,
  UserSummary,
} from "./common";
import { ImageReference } from "./images";
import { SeoMetadata } from "./seo";

export const Profile = z
  .object({
    id: Id,
    username: z.string(),
    groupTitle: z.string(),
    createdAt: Timestamp,
    /** Plain text; clients must escape it. */
    about: z.string(),
    avatar: ImageReference,
    cover: ImageReference,
    postCount: z.number().int().nonnegative(),
    reactionScore: z.number().int(),
    canPostOnWall: z.boolean(),
  })
  .meta({ id: "Profile" });

export const ProfileComment = z
  .object({
    id: Id,
    profilePostId: Id,
    author: UserSummary,
    state: ContentState,
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
    bodyHtml: z.string(),
    reactions: ReactionSummary,
    canEdit: z.boolean(),
    canDelete: z.boolean(),
  })
  .meta({ id: "ProfileComment" });

export const ProfileCommentDetail = ProfileComment.extend({ bodySource: z.string() }).meta({
  id: "ProfileCommentDetail",
});

export const ProfilePost = z
  .object({
    id: Id,
    profileUserId: Id,
    author: UserSummary,
    state: ContentState,
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
    bodyHtml: z.string(),
    attachmentCount: z.number().int().nonnegative(),
    attachments: z.array(Attachment),
    reactions: ReactionSummary,
    commentCount: z.number().int().nonnegative(),
    /** Up to the 3 newest comments the viewer can see, oldest first. */
    latestComments: z.array(ProfileComment),
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    canComment: z.boolean(),
  })
  .meta({ id: "ProfilePost" });

export const ProfilePostDetail = ProfilePost.extend({ bodySource: z.string() }).meta({
  id: "ProfilePostDetail",
});

// Profiles -----------------------------------------------------------------

export const profilesGet = defineContract({
  name: "profiles.get",
  summary: "A user's public profile.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: Profile.extend({ seo: SeoMetadata }),
});

export const profilesUpdate = defineContract({
  name: "profiles.update",
  summary: "Update the current user's own profile.",
  kind: "write",
  input: z.object({ about: z.string().trim().max(5000) }),
  output: Profile,
});

export const usersSearch = defineContract({
  name: "users.search",
  summary: "Find users whose username starts with `prefix` (case-insensitive).",
  kind: "read",
  input: z.object({
    prefix: z.string().trim().min(1).max(32),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  output: z.object({ items: z.array(UserSummary) }),
});

// Profile posts ------------------------------------------------------------

export const profilePostsList = defineContract({
  name: "profilePosts.list",
  summary: "Posts on a user's profile wall, newest first, each with its latest comments.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(ProfilePost),
});

export const profilePostsGet = defineContract({
  name: "profilePosts.get",
  summary: "One profile post with its Markdown source.",
  kind: "read",
  input: z.object({ profilePostId: Id }),
  output: ProfilePostDetail,
});

export const profilePostsCreate = defineContract({
  name: "profilePosts.create",
  summary: "Post on a user's profile wall.",
  kind: "write",
  input: z.object({ userId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: ProfilePostDetail,
});

export const profilePostsUpdate = defineContract({
  name: "profilePosts.update",
  summary: "Edit a profile post. Author or moderator.",
  kind: "write",
  input: z.object({ profilePostId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: ProfilePostDetail,
});

export const profilePostsDelete = defineContract({
  name: "profilePosts.delete",
  summary: "Soft-delete a profile post. Author, wall owner or moderator.",
  kind: "write",
  input: z.object({ profilePostId: Id }),
  output: ProfilePost,
});

export const profilePostsRestore = defineContract({
  name: "profilePosts.restore",
  summary: "Make a deleted or unapproved profile post visible again. Moderators only.",
  kind: "write",
  input: z.object({ profilePostId: Id }),
  output: ProfilePost,
});

// Comments -----------------------------------------------------------------

export const profileCommentsList = defineContract({
  name: "profileComments.list",
  summary: "Comments on a profile post, newest first.",
  kind: "read",
  input: z.object({ profilePostId: Id, ...pageInput }),
  output: Page(ProfileComment),
});

export const profileCommentsGet = defineContract({
  name: "profileComments.get",
  summary: "One comment with its Markdown source.",
  kind: "read",
  input: z.object({ commentId: Id }),
  output: ProfileCommentDetail,
});

export const profileCommentsCreate = defineContract({
  name: "profileComments.create",
  summary: "Comment on a profile post.",
  kind: "write",
  input: z.object({ profilePostId: Id, body: Body }),
  output: ProfileCommentDetail,
});

export const profileCommentsUpdate = defineContract({
  name: "profileComments.update",
  summary: "Edit a comment. Author or moderator.",
  kind: "write",
  input: z.object({ commentId: Id, body: Body }),
  output: ProfileCommentDetail,
});

export const profileCommentsDelete = defineContract({
  name: "profileComments.delete",
  summary: "Soft-delete a comment. Author, wall owner or moderator.",
  kind: "write",
  input: z.object({ commentId: Id }),
  output: ProfileComment,
});

export const profileCommentsRestore = defineContract({
  name: "profileComments.restore",
  summary: "Make a deleted or unapproved comment visible again. Moderators only.",
  kind: "write",
  input: z.object({ commentId: Id }),
  output: ProfileComment,
});
