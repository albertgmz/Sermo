// The sections of the awards page: the categories in the admin's order, each holding its awards in
// the order the backend lists them (easiest first), and last the awards with no category, or with
// one the list of categories does not know (`id` null). A category with nothing to show is left
// out.
export type CatalogueSection<Award> = {
  id: number | null;
  title: string;
  description: string;
  awards: Award[];
};

export function catalogueSections<
  Award extends { category: { id: number } | null },
>(
  awards: readonly Award[],
  categories: readonly { id: number; title: string; description: string }[],
  others: string,
): CatalogueSection<Award>[] {
  const known = new Set(categories.map(({ id }) => id));
  return [
    ...categories.map(({ id, title, description }) => ({
      id,
      title,
      description,
      awards: awards.filter((award) => award.category?.id === id),
    })),
    {
      id: null,
      title: others,
      description: "",
      awards: awards.filter(
        (award) => award.category === null || !known.has(award.category.id),
      ),
    },
  ].filter((section) => section.awards.length > 0);
}
