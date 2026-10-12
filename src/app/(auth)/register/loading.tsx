import {
  FormRowSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { LogoPlaceholder as Logo } from "@/components/layout/logo";
import { PageBackdropPlaceholder as PageBackdrop } from "@/components/layout/page-backdrop";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="relative isolate flex min-h-dvh flex-1 items-center justify-center px-4 py-8">
      <PageBackdrop />
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border bg-background md:min-h-[36rem] md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-muted p-8 md:flex">
          <Logo />
          <TextSkeleton />
        </div>
        <div className="flex flex-col p-4 sm:p-8">
          <div className="flex h-10 items-center justify-between md:justify-end">
            <Logo className="md:hidden" />
            <Skeleton className="h-5 w-12" />
          </div>
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-6">
            <h1 className="text-center text-2xl font-bold tracking-tight">
              Create an account
            </h1>
            <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">
              Enter your email below to create your account
            </p>
            <LoadingRegion label="Loading registration…">
              <div className="space-y-4">
                <FormRowSkeleton />
                <FormRowSkeleton />
                <FormRowSkeleton />
                <Skeleton className="h-1 w-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-10 w-full md:h-8" />
                <Skeleton className="h-10 w-full md:h-5" />
                <Skeleton className="mx-auto h-4 w-32" />
                <Skeleton className="h-10 w-full md:h-8" />
              </div>
            </LoadingRegion>
          </div>
        </div>
      </div>
    </main>
  );
}
