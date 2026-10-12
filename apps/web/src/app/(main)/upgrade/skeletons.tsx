import { CardSkeleton, TextSkeleton } from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import { Skeleton } from "@/components/ui/skeleton";

// The blocks of the page as they settle, shown while it is requested.
export function HeroSkeleton() {
  return (
    <Container className="py-12 md:py-20">
      <div className="max-w-xl">
        <Skeleton className="h-12 w-48 md:h-16" />
        <Skeleton className="mt-4 h-12 w-full max-w-md" />
        <Skeleton className="mt-5 h-11 w-full max-w-md" />
      </div>
    </Container>
  );
}

export function RanksSkeleton() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((rank) => (
        <li key={rank}>
          <CardSkeleton>
            <div className="space-y-4 p-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-10 w-full" />
              <TextSkeleton />
            </div>
          </CardSkeleton>
        </li>
      ))}
    </ul>
  );
}

export function FaqSkeleton() {
  return (
    <div aria-hidden="true" className="max-w-prose space-y-4">
      <Skeleton className="h-8 w-56" />
      <TextSkeleton />
    </div>
  );
}
