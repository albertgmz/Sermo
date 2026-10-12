import { ChannelPreference } from "@sermo/core/contracts";

// The channels of a notification, as the contract lists them.
export const CHANNELS = ChannelPreference.keyof().options;

// The marker of the defaults grid: one hidden field of this name per type the form showed, with
// the type's id. The action writes the cells of those types only.
export const SHOWN_TYPES = "types";
