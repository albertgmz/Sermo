// How long each screen waits between polls, in milliseconds. One tab shows one of the first three
// and the counters beside it, so its polls are at most 20 + 1 a minute (the messages), 6 + 1 (a
// thread), 2 + 1 (the feed), each one backend request.
export const POLL_MS = {
  messages: 3_000,
  thread: 10_000,
  feed: 30_000,
  counters: 60_000,
} as const;
