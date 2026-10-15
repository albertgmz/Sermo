/**
 * The longest message source. The renderer's work is linear in it and bounded in time on top
 * (`RENDER_LIMIT_MS`); at this length the slowest inputs measured stay under 30 ms.
 */
export const MAX_BODY_LENGTH = 10_000;
