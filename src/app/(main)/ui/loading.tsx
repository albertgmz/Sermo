import {
  CardSkeleton,
  EditorSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/layout/page-hero";
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <LoadingRegion label="Loading interface examples…">
      <PageHero
        title="Styleguide"
        subtitle="Every token and reusable component of forum/ui in one place."
      >
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-28" />
      </PageHero>
      <Container className="space-y-12 pb-8">
        <section className="space-y-4">
          <Skeleton className="h-7 w-24" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((token) => (
              <div
                key={token}
                className="overflow-hidden rounded-lg border bg-card"
              >
                <Skeleton className="h-14 rounded-none border-b" />
                <div className="px-2 py-1.5">
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <CardSkeleton>
          <div className="p-4">
            <TextSkeleton />
          </div>
        </CardSkeleton>
        <EditorSkeleton />
      </Container>
    </LoadingRegion>
  );
}
