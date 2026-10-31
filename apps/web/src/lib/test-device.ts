import type { DeviceView } from "./sermo/views";

/** A member's device as the backend gives it: every field, null unless the test names it. */
export const memberDevice = (part: Partial<DeviceView> = {}): DeviceView => ({
  type: null,
  os: null,
  browser: null,
  deviceType: null,
  brand: null,
  brandCode: null,
  osCode: null,
  osVersion: null,
  osFamily: null,
  browserCode: null,
  browserVersion: null,
  ...part,
});
