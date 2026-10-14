import { nodesList, threadPrefixesList } from "@sermo/core/contracts";
import { Suspense } from "react";
import { read } from "@/lib/sermo/client";
import type { Filters } from "./filters";
import { Results } from "./results";
import { SearchForm } from "./search-form";
import { ResultsSkeleton } from "./skeletons";

export async function SearchBody({
  query,
  titlesOnly,
  forum,
  prefix,
  author,
  cursor,
}: Filters & { cursor?: string }) {
  const [{ items: nodes }, { items: allPrefixes }] = await Promise.all([
    read(nodesList, {}),
    read(threadPrefixesList, {}),
  ]);
  const prefixes = allPrefixes.filter((entry) => entry.isActive);
  // A forum or prefix the visitor cannot choose from is left out, as if it were not in the address.
  const filters: Filters = {
    query,
    titlesOnly,
    forum: nodes.some((node) => node.id === forum) ? forum : undefined,
    prefix: prefixes.some((entry) => entry.id === prefix) ? prefix : undefined,
    author,
  };

  return (
    <>
      <SearchForm filters={filters} nodes={nodes} prefixes={prefixes} />
      <Suspense fallback={<ResultsSkeleton />}>
        <Results filters={filters} cursor={cursor} />
      </Suspense>
    </>
  );
}
