import * as z from "zod";
import { defineContract } from "../operation";
import { Attachment, AttachmentIds } from "./attachments";
import {
  Body,
  ContentState,
  DisplayGroup,
  Id,
  Limit,
  moderationNotice,
  Ok,
  Page,
  pageInput,
  ReactionSummary,
  Timestamp,
  UserSummary,
} from "./common";
import { ImageReference } from "./images";
import { MemberCard } from "./members";
import { SeoMetadata } from "./seo";
import { SIGNATURE_FORMATS } from "./settings";

export const Profile = z
  .object({
    id: Id,
    username: z.string(),
    /** Title of the member's primary group. */
    groupTitle: z.string(),
    displayGroup: DisplayGroup.nullable(),
    createdAt: Timestamp,
    /** Plain text; clients must escape it. */
    about: z.string(),
    avatar: ImageReference,
    cover: ImageReference,
    postCount: z.number().int().nonnegative(),
    reactionScore: z.number().int(),
    canPostOnWall: z.boolean(),
    /** How the member is drawn next to their name (users.cards returns the same). */
    card: MemberCard,
    /** The member's own title while they may show one (profile.customTitle); else null. */
    customTitle: z.string().nullable(),
    /**
     * Rendered signature; null when there is none or the member may not show one (they lack
     * profile.signature or no longer hold the site's signature rule).
     */
    signatureHtml: z.string().nullable(),
    /** Plain text; clients must escape it. */
    location: z.string(),
    /** An http(s) URL, or empty. */
    website: z.string(),
    /** Day and month only: the year is never published. */
    birthday: z.object({ month: z.number().int(), day: z.number().int() }).nullable(),
    /** Handles on other networks; empty where none is set. */
    socials: z.object({ discord: z.string(), telegram: z.string(), x: z.string() }),
    followerCount: z.number().int().nonnegative(),
    followingCount: z.number().int().nonnegative(),
    credits: z.number().int(),
    /** XP of the awards held, and the level it gives under the site's level settings. */
    awardXp: z.number().int().nonnegative(),
    level: z.object({
      level: z.number().int().positive(),
      /** XP at which this level starts and at which the next one does. */
      currentLevelXp: z.number().int().nonnegative(),
      nextLevelXp: z.number().int().positive(),
    }),
    /** How many awards the member shows next to their name (profile.awardSlots); -1 = all. */
    awardSlots: z.number().int().min(-1),
    referralCount: z.number().int().nonnegative(),
    /**
     * Last request of the member, to the minute; null if never seen, or when the member hides
     * their online status and the viewer is neither them nor holds profile.bypassPrivacy.
     */
    lastActivityAt: Timestamp.nullable(),
    /** The signed-in viewer's relation to this member; both false for guests and for oneself. */
    viewer: z.object({ isFollowing: z.boolean(), isIgnoring: z.boolean() }),
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
    attachmentCount: z.number().int().nonnegative(),
    attachments: z.array(Attachment),
    reactions: ReactionSummary,
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    /** The viewer holds profilePost.hardDelete: `profileComments.hardDelete` on a deleted comment. */
    canHardDelete: z.boolean(),
    /** The viewer may report it (reports.create would accept it). */
    canReport: z.boolean(),
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
    /** The viewer may report it (reports.create would accept it). */
    canReport: z.boolean(),
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

export const Handle = z
  .string()
  .trim()
  .max(40)
  .regex(/^[A-Za-z0-9_.#-]*$/, "Use letters, digits, dots, underscores, hyphens and #.");

export const BirthdayInput = z.object({
  year: z.number().int().min(1900).max(2100).optional(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

export const profilesUpdate = defineContract({
  name: "profiles.update",
  summary:
    "Update the current user's own profile; only the fields sent change. Setting `customTitle` " +
    "needs profile.customTitle and setting `signature` needs profile.signature and the site's " +
    "signature rule, within the site's limits (characters, lines, links, pictures, emoji and " +
    "text size); clearing either (null) is always allowed. A signature is one small block of " +
    "BB code, rendered when saved: only the kinds of formatting the site allows, no " +
    "quotes, tables, code blocks, spoilers or media; a refusal says what is over. `website` is " +
    "an http(s) URL or empty. `birthday: null` removes it.",
  kind: "write",
  input: z.object({
    about: z.string().trim().max(5000).optional(),
    location: z.string().trim().max(100).optional(),
    website: z
      .string()
      .trim()
      .max(200)
      .regex(/^(?:https?:\/\/\S+)?$/i, "Use an http(s) URL.")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused
      .refine((value) => !/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/.test(value), {
        message: "Use an http(s) URL without control characters.",
      })
      .optional(),
    birthday: BirthdayInput.nullable().optional(),
    socials: z.object({ discord: Handle, telegram: Handle, x: Handle }).partial().optional(),
    customTitle: z.string().trim().max(100).nullable().optional(),
    signature: z.string().trim().max(2000).nullable().optional(),
  }),
  output: Profile,
});

export const profilesSelf = defineContract({
  name: "profiles.self",
  summary:
    "The signed-in member's own profile as they edit it: the public profile, the BB code " +
    "source of the signature, the year of the birthday, what they may currently set, and the " +
    "site's limits. Requires an account.",
  kind: "read",
  input: z.object({}),
  output: z.object({
    profile: Profile,
    /** The stored title and signature, whether or not the member may currently show them. */
    customTitle: z.string().nullable(),
    signatureSource: z.string().nullable(),
    birthYear: z.number().int().nullable(),
    may: z.object({ setSignature: z.boolean(), setCustomTitle: z.boolean() }),
    /**
     * Whether the member may change their username now, by their permissions: `approval` when
     * profile.renameNeedsApproval holds (staff rename them), `limit` when profile.renameLimit is
     * used up, with the time a change frees up when the limit has a window.
     */
    usernameChange: z.object({
      reason: z.enum(["approval", "limit"]).nullable(),
      availableAt: Timestamp.nullable(),
    }),
    /**
     * What the member lacks to set a signature, when they hold profile.signature but not the
     * site's signature rule (a sentence such as "Post count: 3 or more"); null otherwise.
     */
    signatureNeeds: z.string().nullable(),
    limits: z.object({
      signatureMaxLength: z.number().int(),
      signatureMaxLines: z.number().int(),
      /** Counts: 0 or -1 means no limit. */
      signatureMaxLinks: z.number().int(),
      signatureMaxImages: z.number().int(),
      signatureMaxSmilies: z.number().int(),
      signatureMaxTextSize: z.number().int(),
      signatureFormats: z.array(z.enum(SIGNATURE_FORMATS)),
      customTitleMaxLength: z.number().int(),
    }),
  }),
});

export const usersSearch = defineContract({
  name: "users.search",
  summary:
    "Find users whose username starts with `prefix` (case-insensitive). Each says whether the " +
    "member is staff as `users.staff` counts it: in a staff group and not banned; false for " +
    "everyone when the viewer lacks member.viewList.",
  kind: "read",
  input: z.object({
    prefix: z.string().trim().min(1).max(32),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  output: z.object({
    items: z.array(
      UserSummary.extend({
        /**
         * In a group marked as staff (primary, by hand, by promotion or bought) and not banned;
         * false for everyone when the viewer lacks member.viewList.
         */
        staff: z.boolean(),
      }),
    ),
  }),
});

// Profile posts ------------------------------------------------------------

export const profilePostsList = defineContract({
  name: "profilePosts.list",
  summary:
    "Posts on a user's profile wall, newest first, each with its latest comments. Requires " +
    "`profilePost.view`.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(ProfilePost),
});

export const profilePostsGet = defineContract({
  name: "profilePosts.get",
  summary: "One profile post with its BB code source.",
  kind: "read",
  input: z.object({ profilePostId: Id }),
  output: ProfilePostDetail,
});

export const profilePostsLocate = defineContract({
  name: "profilePosts.locate",
  summary:
    "Where a profile post is: its wall, and the `profilePosts.list` cursor that opens the page of " +
    "`limit` posts holding it, the pages counted from the newest post the viewer may see (null " +
    "for the first page). Not found when the viewer may not see the post.",
  kind: "read",
  input: z.object({ profilePostId: Id, limit: Limit }),
  output: z.object({ profilePostId: Id, profileUserId: Id, cursor: z.string().nullable() }),
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
  input: z.object({
    ...moderationNotice,
    profilePostId: Id,
    body: Body,
    attachmentIds: AttachmentIds,
  }),
  output: ProfilePostDetail,
});

export const profilePostsDelete = defineContract({
  name: "profilePosts.delete",
  summary: "Soft-delete a profile post. Author, wall owner or moderator.",
  kind: "write",
  input: z.object({ ...moderationNotice, profilePostId: Id }),
  output: ProfilePost,
});

export const profilePostsHardDelete = defineContract({
  name: "profilePosts.hardDelete",
  summary:
    "Delete a profile post for good, with its comments, reactions, attachments, alerts and " +
    "reports. Only a soft-deleted profile post can be deleted for good (a conflict otherwise). " +
    "Requires profilePost.hardDelete (administrators by default) and the right to see deleted " +
    "profile posts. At most 500 comments go in one call, newest first: the post stays (deleted) " +
    "until a call returns `completed: true`, and cannot be restored meanwhile (a conflict). Each call is one transaction and is logged as " +
    "`profile_post.hardDelete`.",
  kind: "write",
  input: z.object({ profilePostId: Id, reason: moderationNotice.reason }),
  output: z.object({ completed: z.boolean(), removedComments: z.number().int().nonnegative() }),
});

export const profilePostsRestore = defineContract({
  name: "profilePosts.restore",
  summary:
    "Make a deleted or unapproved profile post visible again. Moderators only. A deleted post " +
    "that `profilePosts.hardDelete` has begun on cannot come back (a conflict).",
  kind: "write",
  input: z.object({ ...moderationNotice, profilePostId: Id }),
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
  summary: "One comment with its BB code source.",
  kind: "read",
  input: z.object({ commentId: Id }),
  output: ProfileCommentDetail,
});

export const profileCommentsLocate = defineContract({
  name: "profileComments.locate",
  summary:
    "Where a comment is: its profile post and wall, the `profilePosts.list` cursor of the page " +
    "of `limit` posts holding the post (`wallCursor`) and the `profileComments.list` cursor of " +
    "the page of `limit` comments holding the comment (`commentsCursor`), each counted from the " +
    "newest item the viewer may see (null for a first page). Not found when the viewer may not " +
    "see the comment.",
  kind: "read",
  input: z.object({ commentId: Id, limit: Limit }),
  output: z.object({
    commentId: Id,
    profilePostId: Id,
    profileUserId: Id,
    wallCursor: z.string().nullable(),
    commentsCursor: z.string().nullable(),
  }),
});

export const profileCommentsCreate = defineContract({
  name: "profileComments.create",
  summary: "Comment on a profile post.",
  kind: "write",
  input: z.object({ profilePostId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: ProfileCommentDetail,
});

export const profileCommentsUpdate = defineContract({
  name: "profileComments.update",
  summary: "Edit a comment. Author or moderator.",
  kind: "write",
  input: z.object({ ...moderationNotice, commentId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: ProfileCommentDetail,
});

export const profileCommentsDelete = defineContract({
  name: "profileComments.delete",
  summary: "Soft-delete a comment. Author, wall owner or moderator.",
  kind: "write",
  input: z.object({ ...moderationNotice, commentId: Id }),
  output: ProfileComment,
});

export const profileCommentsHardDelete = defineContract({
  name: "profileComments.hardDelete",
  summary:
    "Delete a comment for good, with its reactions, attachments, alerts and reports; the wall " +
    "post's comment count follows. Only a soft-deleted comment can be deleted for good (a " +
    "conflict otherwise). Requires profilePost.hardDelete (administrators by default) and the " +
    "right to see deleted comments. Logged as `profile_comment.hardDelete`.",
  kind: "write",
  input: z.object({ commentId: Id, reason: moderationNotice.reason }),
  output: Ok,
});

export const profileCommentsRestore = defineContract({
  name: "profileComments.restore",
  summary: "Make a deleted or unapproved comment visible again. Moderators only.",
  kind: "write",
  input: z.object({ ...moderationNotice, commentId: Id }),
  output: ProfileComment,
});
