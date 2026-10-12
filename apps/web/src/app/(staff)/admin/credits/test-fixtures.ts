// Answers of the backend for the action tests of the Economy section: each is a whole record, as
// the contract describes it, because the seam checks every answer against its contract.

const STAMPS = {
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const CATEGORY = {
  id: 1,
  name: "Goodies",
  description: "",
  position: 0,
  isActive: true,
  ...STAMPS,
};

export const ITEM = {
  id: 5,
  categoryId: 1,
  name: "Item",
  description: "",
  icon: "",
  image: null,
  price: 10,
  isActive: true,
  stock: null,
  isConsumable: false,
  isGiftable: false,
  durationSeconds: null,
  effect: { type: "bump" },
  position: 0,
  ...STAMPS,
};

export const AWARD = {
  id: 7,
  name: "Hero",
  description: "",
  icon: "",
  image: null,
  tier: "gold",
  xp: 50,
  credits: 0,
  isStackable: false,
  isActive: true,
  criteria: [],
  grantCount: 0,
  ...STAMPS,
};

export const MEMBER_AWARD = {
  id: 9,
  user: { id: 4, username: "wren" },
  award: AWARD,
  grantedBy: { id: 1, username: "nova" },
  reason: "",
  grantedAt: "2026-01-01T00:00:00.000Z",
};

export const TRANSACTION = {
  id: 1,
  userId: 4,
  amount: 5,
  balanceAfter: 5,
  type: "adjustment",
  source: null,
  actor: { id: 1, username: "nova" },
  reason: "r",
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const SETTINGS = {
  maxUploadBytes: 1000,
  allowedUploadTypes: {
    attachment: ["image/png"],
    avatar: ["image/png"],
    cover: ["image/png"],
    node_icon: ["image/png"],
    node_cover: ["image/png"],
  },
  groupUploadLimitBytes: {},
  firstPostsToModerate: 0,
  moderateLinksFromNewMembers: false,
  warningBanThreshold: 0,
  warningBanDays: 7,
  threadTitleTemplate: "{title}",
  nodeTitleTemplate: "{title}",
  profileTitleTemplate: "{username}",
  indexNowKey: null,
};
