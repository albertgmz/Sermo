/**
 * The longest message source. The renderer's work is linear in it and bounded in time on top
 * (`RENDER_LIMIT_MS`); at this length the slowest inputs measured stay under 12 ms.
 */
export const MAX_BODY_LENGTH = 10_000;

/** Players ([MEDIA]) one message may embed; the ones after that are links to the provider's page. */
export const MAX_MEDIA_EMBEDS = 50;

/** Tags one thread can carry. */
export const MAX_THREAD_TAGS = 10;
