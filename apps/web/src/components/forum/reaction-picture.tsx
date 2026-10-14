import { cn } from "@/lib/utils";

// How long each frame of a sprite sheet stays on screen. One value for every reaction: there is
// no per-frame timing.
export const REACTION_FRAME_MS = 100;
// The height of a reaction picture, in the font size of the text it sits in (an emoji's glyph is
// about this tall).
const HEIGHT_EM = 1.25;

// The picture of a reaction type that LITE let through. It is made on the server, by
// `lib/sermo/reactions.ts`, and is null when the visitor blocks the `reactions` category: this
// component draws what it is given and never decides, so the URL of a blocked picture does not
// exist on the client.
export declare const gated: unique symbol;
export type ReactionPictureData = {
  // Type-level seal: only data that went through `withoutBlockedPictures` carries it.
  readonly [gated]: true;
  url: string;
  // How a sprite sheet is cut; null when the whole picture is the frame.
  frames: {
    width: number;
    height: number;
    count: number;
    columns: number;
  } | null;
};

// The one place a reaction picture is emitted (see EMISSION_GATES in tests/lite-static.test.ts).
// A plain image is drawn whole inside a square box; a sprite sheet is a box of one frame whose
// background is stepped through the frames by a CSS animation, no script. With reduced motion the
// animation is off and the first frame stays. Without a picture the emoji is drawn as text.
//
// `label` is the accessible name (the type's title); leave it out where the surroundings already
// name the reaction and the emoji or picture is decoration.
export function ReactionPicture({
  emoji,
  picture,
  label,
  className,
}: {
  emoji: string;
  picture: ReactionPictureData | null;
  label?: string;
  className?: string;
}) {
  const naming = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);
  if (!picture)
    return (
      <span {...naming} className={className}>
        {emoji}
      </span>
    );
  const { url, frames } = picture;
  // Every picture sits in the same square box, scaled to fit and centred, whatever its aspect.
  const box = cn(
    "inline-flex size-[1.25em] shrink-0 items-center justify-center align-middle",
    className,
  );
  if (!frames)
    return (
      <span
        {...naming}
        data-slot="reaction-picture"
        className={cn(box, "bg-contain bg-center bg-no-repeat")}
        style={{ backgroundImage: cssUrl(url) }}
      />
    );
  // The frame is fitted into the box by its longer side. Its width is rounded down to whole
  // pixels, and the sheet is scaled from that width, so every frame starts on a whole pixel
  // column and no sliver of the next frame shows. A frame row is the width times the frame's
  // ratio, whole for square frames; a non-square sheet with several rows can still land a row
  // on a fraction of a pixel.
  const ratio = frames.width / frames.height;
  const fitted = ratio >= 1 ? HEIGHT_EM : HEIGHT_EM * ratio;
  const style = {
    width: "var(--rx-w)",
    height: "var(--rx-h)",
    backgroundImage: cssUrl(url),
    backgroundSize: `calc(var(--rx-w) * ${frames.columns}) auto`,
    backgroundPosition: "0 0",
    "--rx-w": `round(down, ${fitted.toFixed(4)}em, 1px)`,
    "--rx-h": `calc(var(--rx-w) * ${(frames.height / frames.width).toFixed(6)})`,
    "--rx-anim": `${sheetName(frames)} ${frames.count * REACTION_FRAME_MS}ms step-end infinite`,
  } as React.CSSProperties;
  return (
    <>
      {frames.count > 1 && (
        <style href={sheetName(frames)} precedence="reaction-picture">
          {sheetKeyframes(frames)}
        </style>
      )}
      <span
        {...naming}
        data-slot="reaction-picture"
        data-frames={frames.count}
        className={box}
      >
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 bg-no-repeat",
            frames.count > 1 &&
              "animate-(--rx-anim) motion-reduce:animate-none",
          )}
          style={style}
        />
      </span>
    </>
  );
}

// A URL as a CSS function argument: a quoted string in which the quote, the backslash and every
// control character is escaped, so nothing in the address can end the string.
export function cssUrl(url: string): string {
  let escaped = "";
  for (const char of url) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"' || char === "\\") escaped += "\\" + char;
    else if (code < 0x20 || code === 0x7f)
      escaped += "\\" + code.toString(16) + " ";
    else escaped += char;
  }
  return 'url("' + escaped + '")';
}

// The animation depends only on the number of columns and of frames, so sheets that share both
// share one rule, which React places in the head once.
const sheetName = ({ columns, count }: { columns: number; count: number }) =>
  `rx-${columns}-${count}`;

// One keyframe per frame, each holding until the next: the offset is a whole number of boxes.
function sheetKeyframes(frames: { columns: number; count: number }) {
  const steps: string[] = [];
  for (let index = 0; index < frames.count; index++) {
    const at = ((index / frames.count) * 100).toFixed(4);
    const column = index % frames.columns;
    const row = Math.floor(index / frames.columns);
    steps.push(
      `${at}%{background-position:calc(var(--rx-w)*-${column}) calc(var(--rx-h)*-${row})}`,
    );
  }
  return `@keyframes ${sheetName(frames)}{${steps.join("")}}`;
}
