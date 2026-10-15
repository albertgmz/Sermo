import assert from "node:assert/strict";
import { test } from "node:test";
import { placeLabel } from "./location";

test("a place reads city, region, then the country in the reader's language", () => {
  const place = { country: "ES", region: "Catalonia", city: "Barcelona" };
  assert.equal(placeLabel(place, "en"), "Barcelona, Catalonia, Spain");
  assert.equal(placeLabel(place, "es"), "Barcelona, Catalonia, España");
});

test("missing parts and repeated names are left out", () => {
  assert.equal(
    placeLabel({ country: "SG", region: "Singapore", city: "Singapore" }, "en"),
    "Singapore",
  );
  assert.equal(
    placeLabel({ country: "FR", region: null, city: null }, "en"),
    "France",
  );
  assert.equal(
    placeLabel({ country: null, region: null, city: null }, "en"),
    null,
  );
  assert.equal(placeLabel(null, "en"), null);
  // A code Intl does not know is shown as it is.
  assert.equal(
    placeLabel({ country: "ZZ9", region: null, city: null }, "en"),
    "ZZ9",
  );
});
