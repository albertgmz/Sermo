import {
  ReactionButton,
  type ReactionType,
} from "@/components/forum/reaction-button";
import { cn } from "@/lib/utils";

// Whether the viewer has a button to press: a guest gets the sign-in link, a member gets the
// button unless the item is their own or takes no reactions.
export function canReact(
  viewerId: number | null,
  authorId: number,
  picker: ReactionType[],
) {
  return viewerId === null || (viewerId !== authorId && picker.length > 0);
}

// The reaction control of one item, free of the backend: `Reactions` binds the actions, the
// styleguide fakes them. The button sets the viewer's own reaction and shows the count; the
// summary beside it (drawn on the server, it lists members) opens who reacted and shows the
// number only where there is no button (see `canReact`), so the number appears once.
export function ReactionControl({
  action,
  total,
  viewerTypeId,
  picker,
  viewerId,
  authorId,
  summary,
  size,
  className,
}: {
  action: (typeId: number | null) => Promise<{ error?: string } | undefined>;
  total: number;
  viewerTypeId: number | null;
  picker: ReactionType[];
  viewerId: number | null;
  authorId: number;
  // A `ReactionSummary` with `showTotal` off exactly when `canReact`; none when nobody reacted.
  summary: React.ReactNode;
  size?: "default" | "sm";
  className?: string;
}) {
  const pressable = canReact(viewerId, authorId, picker);
  // Nothing to press and nothing to show: no box at all, so a row's gap does not widen.
  if (!pressable && !summary) return null;
  return (
    <div
      className={cn(
        "flex items-center",
        size === "sm" && "-my-1.5 md:my-0",
        className,
      )}
    >
      {pressable && (
        <ReactionButton
          action={action}
          total={total}
          viewerTypeId={viewerTypeId}
          types={picker}
          viewerId={viewerId}
          authorId={authorId}
          size={size}
        />
      )}
      {summary}
    </div>
  );
}
