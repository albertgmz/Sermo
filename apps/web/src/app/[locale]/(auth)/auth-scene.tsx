import "./auth-scene.css";
import { getTranslations } from "next-intl/server";
import { type CSSProperties, Suspense } from "react";
import { liteBlocks } from "@/lib/lite-mode";

type Bubble = {
  // An emoji, or the chatter whose words the bubble says.
  say: string | { talk: "hello" | "cheer" };
  // Its lane across the wide panel and where it rests there when motion is off (percent).
  x: number;
  y: number;
  // Its size, the seconds it takes to rise through the panel, how far up it is at first paint
  // (0 to 1, so the panel is already full when it appears) and, for a far one, its opacity.
  s: number;
  t: number;
  d: number;
  o?: number;
  // Its lane and resting place on a phone's band, right of the site's name; without one, the
  // bubble is drawn only on the wide panel.
  phone?: [number, number];
};

// Talk rising from the sea at the foot of the panel: a coffee, the royal palm, son and rumba,
// baseball, a mojito, the caiman the island is shaped like. On the wide panel the side lanes keep
// clear of the flag and the site's name, and the ones that cross the middle are small and far.
const BUBBLES: Bubble[] = [
  {
    say: { talk: "hello" },
    x: 60,
    y: 74,
    s: 1,
    t: 22,
    d: 0.55,
    phone: [56, 8],
  },
  { say: "🌴", x: 84, y: 32, s: 1.25, t: 20, d: 0.3, phone: [56, 44] },
  { say: "☕", x: 12, y: 80, s: 1.15, t: 18, d: 0, phone: [86, 40] },
  { say: { talk: "cheer" }, x: 5, y: 66, s: 1, t: 23, d: 0.2, phone: [72, 62] },
  { say: "🌺", x: 88, y: 84, s: 0.95, t: 15, d: 0.12, phone: [88, 8] },
  { say: "🎺", x: 10, y: 38, s: 0.9, t: 16, d: 0.7 },
  { say: "⚾", x: 84, y: 62, s: 0.85, t: 17, d: 0.85 },
  { say: "🍹", x: 34, y: 84, s: 1, t: 21, d: 0.42 },
  { say: "🐊", x: 36, y: 9, s: 0.7, t: 26, d: 0.6, o: 0.8 },
  { say: "🥁", x: 6, y: 14, s: 0.8, t: 19, d: 0.9 },
  { say: "🥭", x: 60, y: 17, s: 0.65, t: 27, d: 0.35, o: 0.8 },
  { say: "💃", x: 88, y: 10, s: 0.9, t: 18, d: 0.66 },
  { say: "🎶", x: 90, y: 48, s: 0.75, t: 24, d: 0.05, o: 0.8 },
  { say: "🌅", x: 22, y: 22, s: 0.7, t: 25, d: 0.8, o: 0.8 },
];

// Three swells, each eight of its own waves wide, so sliding by half loops without a seam.
const WAVES = [
  "M0 9 Q12.5 1 25 9 T50 9 T75 9 T100 9 T125 9 T150 9 T175 9 T200 9 V20 H0 Z",
  "M0 11 Q12.5 4 25 11 T50 11 T75 11 T100 11 T125 11 T150 11 T175 11 T200 11 V20 H0 Z",
  "M0 13 Q12.5 7 25 13 T50 13 T75 13 T100 13 T125 13 T150 13 T175 13 T200 13 V20 H0 Z",
];

const placeOf = ({ x, y, s, t, d, o = 1, phone }: Bubble) =>
  ({
    "--x": `${x}%`,
    "--y": `${y}%`,
    ...(phone && { "--px": `${phone[0]}%`, "--py": `${phone[1]}%` }),
    "--s": s,
    "--t": t,
    "--d": d,
    "--o": o,
  }) as CSSProperties;

// The night over the Malecón behind the sign-in pages' flag: stars, the sea, and bubbles of talk
// rising from it. Drawn, not loaded, and decoration only; it moves only for visitors who did not
// ask their device for less motion (auth-scene.css). Brand artwork, like the flag: a visitor whose
// LITE mode leaves that out gets the plain night of the panel.
export function AuthScene() {
  return (
    <Suspense>
      <ResolvedAuthScene />
    </Suspense>
  );
}

async function ResolvedAuthScene() {
  if (await liteBlocks("brand")) return null;
  const t = await getTranslations("auth.shell.chatter");
  return (
    <div aria-hidden="true" className="auth-scene">
      <span className="auth-stars" />
      {BUBBLES.map((bubble) => (
        <span
          key={`${bubble.x} ${bubble.y}`}
          className={`auth-bubble${bubble.phone ? "" : " max-md:hidden"}`}
          style={placeOf(bubble)}
        >
          {typeof bubble.say === "string" ? (
            <span>{bubble.say}</span>
          ) : (
            <span data-talk={bubble.say.talk}>{t(bubble.say.talk)}</span>
          )}
        </span>
      ))}
      <span className="auth-sea">
        {WAVES.map((path) => (
          <svg
            key={path}
            viewBox="0 0 200 20"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            className="auth-wave"
          >
            <path d={path} />
          </svg>
        ))}
      </span>
    </div>
  );
}
