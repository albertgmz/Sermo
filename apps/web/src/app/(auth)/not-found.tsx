import { RouteNotFound } from "@/components/layout/route-not-found";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">
        <RouteNotFound />
      </div>
    </main>
  );
}
