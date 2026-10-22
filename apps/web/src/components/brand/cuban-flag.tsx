import { Suspense } from "react";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { liteBlocks } from "@/lib/lite-mode";
import { cn } from "@/lib/utils";

// The flag on a 30 by 15 grid (its 1:2 proportion): five stripes of 3, an equilateral triangle
// whose side is the hoist, and the star centred in the triangle, its points on a circle a third of
// the hoist across.
const HOIST = 15;
const TIP = (HOIST * Math.sqrt(3)) / 2;
const STAR_X = TIP / 3;
const STAR_Y = HOIST / 2;
const STAR_OUTER = HOIST / 6;
const STAR_INNER =
  (STAR_OUTER * Math.sin(Math.PI / 10)) / Math.sin((3 * Math.PI) / 10);

const round = (value: number) => Number(value.toFixed(3));

const TRIANGLE = `0,0 ${round(TIP)},${STAR_Y} 0,${HOIST}`;
const STAR = Array.from({ length: 10 }, (_, index) => {
  const radius = index % 2 === 0 ? STAR_OUTER : STAR_INNER;
  const angle = -Math.PI / 2 + (index * Math.PI) / 5;
  return `${round(STAR_X + radius * Math.cos(angle))},${round(STAR_Y + radius * Math.sin(angle))}`;
}).join(" ");

const BOX = "relative block aspect-[2/1] overflow-hidden";

// The Cuban flag, drawn rather than loaded, with light moving slowly over it. Decorative: the
// text beside it says what the page is. Size it by width or height; it keeps its proportion. A
// visitor whose LITE mode leaves out brand artwork gets a placeholder of the same size.
export function CubanFlag({ className }: { className?: string }) {
  return (
    <Suspense
      fallback={<span aria-hidden="true" className={cn(BOX, className)} />}
    >
      <ResolvedCubanFlag className={className} />
    </Suspense>
  );
}

async function ResolvedCubanFlag({ className }: { className?: string }) {
  if (await liteBlocks("brand"))
    return <LitePlaceholder compact className={cn(BOX, className)} />;
  return (
    <span aria-hidden="true" className={cn("flag-wave", BOX, className)}>
      <svg
        viewBox="0 0 30 15"
        aria-hidden="true"
        focusable="false"
        className="block size-full"
      >
        <rect width="30" height="15" className="fill-flag-blue" />
        <rect y="3" width="30" height="3" className="fill-flag-white" />
        <rect y="9" width="30" height="3" className="fill-flag-white" />
        <polygon points={TRIANGLE} className="fill-flag-red" />
        <polygon points={STAR} className="fill-flag-white" />
      </svg>
    </span>
  );
}
