import messages from "../../messages/en/lib.json";

// Keep these fields until renderers resolve lib.permissions by permission.key.
export const PERMISSIONS = [
  {
    key: "signature",
    label: messages.permissions.signature.label,
    description: messages.permissions.signature.description,
    icon: "signature",
  },
  {
    key: "profileCover",
    label: messages.permissions.profileCover.label,
    description: messages.permissions.profileCover.description,
    icon: "image",
  },
  {
    key: "customTitle",
    label: messages.permissions.customTitle.label,
    description: messages.permissions.customTitle.description,
    icon: "tag",
  },
  {
    key: "awardSlot",
    label: messages.permissions.awardSlot.label,
    description: messages.permissions.awardSlot.description,
    icon: "award",
  },
  {
    key: "usernameChange",
    label: messages.permissions.usernameChange.label,
    description: messages.permissions.usernameChange.description,
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
