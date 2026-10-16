/**
 * The longest message source. The renderer's work is linear in it and bounded in time on top
 * (`RENDER_LIMIT_MS`); at this length the slowest inputs measured stay under 12 ms.
 */
export const MAX_BODY_LENGTH = 10_000;

/** Players ([MEDIA]) one message may embed; the ones after that are links to the provider's page. */
export const MAX_MEDIA_EMBEDS = 50;

/** Tags one thread can carry. */
export const MAX_THREAD_TAGS = 10;

/** Polls and quizzes: sizes of what a creator writes. */
export const POLL_QUESTION_LENGTH = 200;
export const POLL_ANSWER_LENGTH = 100;
export const POLL_EXPLANATION_LENGTH = 500;
/** Answers of a poll (one question) and of one question of a quiz. */
export const MAX_POLL_ANSWERS = 20;
export const MAX_QUIZ_ANSWERS = 8;
export const MAX_QUIZ_QUESTIONS = 20;
/**
 * Members whose votes one transaction removes when a poll is deleted or an answer is dropped (a
 * member holds up to 20 votes, and every vote and ballot fires a counter trigger): a poll with more
 * voters is removed in batches of this many.
 */
export const POLL_PURGE_BATCH = 2_000;
