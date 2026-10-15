import { creditRulesCreate } from "@sermo/core/contracts";

// What the backend answers for the records the panel and the forum pages fake in their tests, with
// every field its contract lists. A test overrides only what it is about; when the backend adds a
// field, it is added here and nowhere else.

export function groupBody(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: "Writers",
    description: "",
    rank: 20,
    userTitle: "",
    badge: "",
    builtin: null,
    nameColorId: 3,
    isStaff: false,
    memberCount: 4,
    ...over,
  };
}

// What site.get answers: the identity a test is about goes in `over`.
export function siteBody(over: Record<string, unknown> = {}) {
  return {
    name: "Garden Club",
    description: "",
    logo: null,
    icon: null,
    backdrop: null,
    socialLinks: { discord: null, telegram: null, x: null },
    maxUploadBytes: 5 * 1024 * 1024,
    forumStatsEnabled: false,
    analytics: { provider: "none" },
    defaultLanguage: "en",
    palette: { accents: [], nameColors: [], prefixColors: [] },
    ...over,
  };
}

// What creditRules.list answers: the rules and every trigger, `forums` being those that accept a
// restriction to forums.
export function creditRulesBody(
  items: unknown[] = [],
  forums: string[] = [
    "thread_created",
    "reply_posted",
    "reply_received",
    "reaction_given",
    "reaction_received",
  ],
) {
  return {
    items,
    triggers: creditRulesCreate.input.shape.trigger.options.map((id) => ({
      id,
      acceptsForums: forums.includes(id),
    })),
  };
}

// The answer to a request for the site, or null for any other request: the upload routes read the
// site's upload limit, which the tests of those routes do not ask about.
export function siteAnswer(url: string, over: Record<string, unknown> = {}) {
  return new URL(url).pathname === "/api/v1/site"
    ? Response.json(siteBody(over))
    : null;
}

export function notificationTypeBody(
  id: string,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    label: id,
    description: id,
    defaults: { inApp: true, email: false, push: false },
    required: false,
    emailFollowsWatch: false,
    channels: ["inApp", "email"],
    ...over,
  };
}

export function permissionDefinitionBody(
  id: string,
  type: "flag" | "integer",
  scope = "global",
) {
  return {
    id,
    scope,
    type,
    category: "forum",
    unit: type === "integer" ? "count" : null,
    label: `permission.${id}`,
    description: `permission.${id}.description`,
    title: `Title of ${id}`,
    help: `Help for ${id}`,
    categoryTitle: "Forum",
    defaults: {},
    requiresAccount: false,
    restriction: null,
    ownContentOnly: false,
    timeLimit: null,
    hierarchy: false,
    threadBan: false,
  };
}

export function postBody(over: Record<string, unknown> = {}) {
  return {
    id: 31,
    threadId: 7,
    position: 25,
    author: { id: 3, username: "ember" },
    state: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    bodyHtml: "",
    attachmentCount: 0,
    attachments: [],
    reactions: { counts: {}, total: 0, mine: null },
    canEdit: true,
    canDelete: true,
    canReport: true,
    bodySource: "",
    ...over,
  };
}

// A comment on a wall post, as profileComments.list and profileComments.get answer.
export function profileCommentBody(over: Record<string, unknown> = {}) {
  return {
    id: 44,
    profilePostId: 12,
    author: { id: 3, username: "ember" },
    state: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    bodyHtml: "",
    reactions: { counts: {}, total: 0, mine: null },
    canEdit: false,
    canDelete: false,
    bodySource: "",
    ...over,
  };
}

// A wall post, as profilePosts.list and profilePosts.get answer.
export function profilePostBody(over: Record<string, unknown> = {}) {
  return {
    id: 12,
    profileUserId: 9,
    author: { id: 3, username: "ember" },
    state: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    bodyHtml: "",
    attachmentCount: 0,
    attachments: [],
    reactions: { counts: {}, total: 0, mine: null },
    commentCount: 0,
    latestComments: [],
    canEdit: false,
    canDelete: false,
    canComment: false,
    bodySource: "",
    ...over,
  };
}
