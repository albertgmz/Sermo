// A footer button. Inside a footer bar (`ContentActions`) it is a filled pill, as XenForo's: the bar
// sets `--action-fill`; elsewhere it stays plain.
export const messageActionClass =
  "inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border-0 bg-[color:var(--action-fill,transparent)] px-2 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary-ink md:h-8 md:min-w-8 [&_svg]:size-4 [&_svg]:shrink-0";

// The text of a bar button: drawn from `sm` up, the button's `aria-label` carries it below.
export const actionLabelClass = "hidden sm:inline";

// A control in the header row of a post (share, bookmark, the post number), as XenForo's message
// attribution draws them: a small muted icon, 40 px wide on a phone and 28 px from `md` up.
export const attributionGadgetClass =
  "inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-md border-0 bg-transparent px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:h-7 md:min-w-7 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";
