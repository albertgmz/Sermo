// The approximate place a sign-in came from, as the backend recorded it: city, region and country
// code, any of them missing. The country is written in the reader's language.
export type Place = {
  country: string | null;
  region: string | null;
  city: string | null;
};

export function placeLabel(
  place: Place | null | undefined,
  locale: string,
): string | null {
  if (!place) return null;
  let country = place.country;
  if (country) {
    try {
      country =
        new Intl.DisplayNames([locale], { type: "region" }).of(country) ??
        country;
    } catch {
      // not a region code Intl knows: show the code
    }
  }
  const parts = [place.city, place.region, country].filter(
    (part, at, all): part is string => !!part && all.indexOf(part) === at,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}
