/**
 * Rendering cost grows faster than linearly on adversarial input; at 10,000 characters the
 * worst cases measured stay around 45 ms. Deep quote nesting overflows the parser's stack.
 */
export const MAX_BODY_LENGTH = 10_000;
