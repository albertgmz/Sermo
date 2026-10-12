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

export function criterionBody(
  id: string,
  kind: "atLeast" | "boolean",
  unit: "count" | "boolean",
) {
  return {
    id,
    label: `promotion.criterion.${id}`,
    description: `promotion.criterion.${id}.description`,
    title: `Title of ${id}`,
    help: `Help for ${id}`,
    kind,
    unit,
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
