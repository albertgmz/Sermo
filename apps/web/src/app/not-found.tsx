import { Container } from "@/components/layout/container";
import { RouteNotFound } from "@/components/layout/route-not-found";

export default function NotFound() {
  return (
    <Container className="flex flex-1 items-center justify-center py-8">
      <div className="w-full max-w-md">
        <RouteNotFound />
      </div>
    </Container>
  );
}
