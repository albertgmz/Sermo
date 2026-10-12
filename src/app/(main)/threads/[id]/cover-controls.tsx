import { CoverControlsClient } from "@/app/(main)/threads/[id]/cover-controls-client";
import { Art } from "@/components/forum/art";

export type OwnedCover = {
  itemId: number;
  name: string;
  src: string;
  quantity: number;
};

export function CoverControls({
  threadId,
  hasCover,
  own,
  covers,
}: {
  threadId: number;
  hasCover: boolean;
  own: boolean;
  covers: OwnedCover[];
}) {
  return (
    <CoverControlsClient
      threadId={threadId}
      hasCover={hasCover}
      own={own}
      covers={covers.map(({ itemId, name, quantity, src }) => ({
        itemId,
        name,
        quantity,
        preview: <Art src={src} className="aspect-[5/2] w-full" />,
      }))}
    />
  );
}
