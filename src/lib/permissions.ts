export const PERMISSIONS = [
  {
    key: "signature",
    label: "Signature",
    description: "Add a short signature that is shown under your posts.",
    icon: "signature",
  },
  {
    key: "profileCover",
    label: "Profile cover",
    description:
      "Pick a photo from the gallery as the cover of your profile, your posts and your member card.",
    icon: "image",
  },
  {
    key: "customTitle",
    label: "Custom title",
    description: "Replace the title under your name with your own text.",
    icon: "tag",
  },
  {
    key: "awardSlot",
    label: "Award showcase slot",
    description: "Show one more award next to your name.",
    icon: "award",
  },
  {
    key: "usernameChange",
    label: "Username change",
    description: "Change your username. Each purchase allows one change.",
    icon: "at-sign",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionKey = Permission["key"];

export const SIGNATURE_MAX_LENGTH = 300;
export const SIGNATURE_MAX_LINES = 4;
export const TITLE_MAX_LENGTH = 40;
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

// Awards shown next to a name: on phones, and from `md` up.
export const AWARD_SLOTS = { mobile: 3, desktop: 5 };

type Holder = { permissions: readonly string[] };

export function can(
  user: Holder | null | undefined,
  key: PermissionKey,
): boolean {
  return user?.permissions.includes(key) ?? false;
}

export function awardSlots(user: Holder | null | undefined) {
  const extra = can(user, "awardSlot") ? 1 : 0;
  return {
    mobile: AWARD_SLOTS.mobile + extra,
    desktop: AWARD_SLOTS.desktop + extra,
  };
}
