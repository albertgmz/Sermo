// The edge and fill of every shared form control (`Input`, `Textarea`, the select's button), in
// both themes: one place, so that a form mixing them shows one surface. The editor's box takes the
// same fill (`EDITOR_BOX`).
export const FIELD_FILL = "bg-card";
export const FIELD_SURFACE = `border border-input ${FIELD_FILL}`;

// The look of `Input` without its surface, also for a plain `<input>` in a page that ships no
// client code.
export const INPUT_CLASS =
  "h-10 w-full min-w-0 rounded-lg px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:h-8 md:text-sm dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";
