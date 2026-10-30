import type { ScreenKey } from "../../../registry";

// The tabs of a member in their order, each a screen of the registry.
export const TABS = [
  "usersEdit",
  "usersGroups",
  "usersProfile",
  "usersAppearance",
  "usersPermissions",
  "usersSanctions",
  "usersEconomy",
  "usersSessions",
  "usersHistory",
] as const satisfies readonly ScreenKey[];
