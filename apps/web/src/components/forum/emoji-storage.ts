// What the emoji picker remembers in this browser: the last things picked (an emoji as it went in,
// a smilie by its code), and the skin tone chosen (0 is none, 1 to 5 light to dark). Kept apart
// from the picker so the cookie list can name them without loading it.
export const RECENT_KEY = "sermo.emoji.recent";
export const TONE_KEY = "sermo.emoji.tone";
