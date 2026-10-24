import { messageActionClass } from "@/components/forum/message-action";
import { cn } from "@/lib/utils";

// The line of a wall composer while it is closed (the avatar, a pill that opens it, a button that
// opens it to attach a file): drawn by `LazyPostComposer` before the composer's code is there and
// by `PostComposer` once it is, from the same classes so that nothing moves when it arrives.
export const POST_LINE = "flex items-center gap-2";
export const POST_PILL =
  "h-10 min-w-0 flex-1 truncate rounded-full border bg-card px-4 text-left text-base text-muted-foreground transition-colors hover:border-ring md:text-sm";
export const POST_ATTACH = cn(
  messageActionClass,
  "size-10 shrink-0 px-0 md:size-10",
);
