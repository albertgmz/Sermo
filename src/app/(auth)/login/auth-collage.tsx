import { cn } from "@/lib/utils";

const TILES = Array.from({ length: 40 }, (_, index) => index);

function HeroTile() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,color-mix(in_oklab,var(--primary)_28%,transparent),transparent_75%)] p-4">
      <span className="h-3 w-3/4 rounded-full bg-foreground" />
      <span className="h-3 w-1/2 rounded-full bg-foreground" />
      <span className="mt-1 h-1.5 w-2/3 rounded-full bg-muted-foreground/40" />
      <span className="flex -space-x-1.5 pt-1">
        <span className="size-5 rounded-full bg-muted-foreground ring-2 ring-background" />
        <span className="size-5 rounded-full bg-primary ring-2 ring-background" />
        <span className="size-5 rounded-full bg-input ring-2 ring-background" />
      </span>
      <span className="mt-1 h-6 w-24 rounded-md bg-primary" />
    </div>
  );
}

function ListTile() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 p-4">
      {["w-2/3", "w-1/2", "w-3/5", "w-2/5"].map((width, index) => (
        <span key={width} className="flex items-center gap-2">
          <span className="size-4 shrink-0 rounded-full border border-muted-foreground/60" />
          <span className={cn("h-2 rounded-full bg-foreground/80", width)} />
          {index === 0 && <span className="h-3 w-7 rounded-sm bg-primary" />}
        </span>
      ))}
    </div>
  );
}

function BarTile() {
  return (
    <div className="flex h-full flex-col justify-end gap-3 bg-muted p-4">
      <span className="flex items-center justify-between">
        <span className="h-2 w-10 rounded-full bg-muted-foreground/50" />
        <span className="h-6 w-20 rounded-md bg-primary" />
      </span>
      <span className="flex h-9 items-center gap-2 rounded-lg bg-foreground/90 px-3">
        <span className="size-2 rounded-full bg-background/50" />
        <span className="h-2 flex-1 rounded-full bg-background/30" />
        <span className="size-3 rounded-full border-2 border-background/50" />
      </span>
    </div>
  );
}

const KINDS = [HeroTile, ListTile, BarTile];

export function AuthCollage({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative overflow-hidden border-l bg-card", className)}
    >
      <div className="absolute top-1/2 left-1/2 grid w-[80rem] -translate-x-1/2 -translate-y-1/2 -rotate-[35deg] grid-cols-5 gap-4">
        {TILES.map((tile) => {
          const Tile = KINDS[tile % KINDS.length];
          return (
            <div
              key={tile}
              className="h-52 overflow-hidden rounded-xl border bg-background"
            >
              <Tile />
            </div>
          );
        })}
      </div>
    </div>
  );
}
