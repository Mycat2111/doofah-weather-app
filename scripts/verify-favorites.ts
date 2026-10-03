/**
 * Checks for favorite places and how they are saved.
 * Run with: npm run verify:favorites
 */
import assert from "node:assert/strict";
import {
  addFavorite,
  findFavorite,
  openingPlace,
  parseFavorites,
  parseLastPlace,
  removeFavorite,
  renameFavorite,
  serializeFavorites,
  type Favorite,
} from "../src/lib/favorites";
import { favoriteName } from "../src/i18n/places";
import { MESSAGES } from "../src/i18n/messages";
import { placeForPoint, PLACES } from "../src/services/weather/places";

const place = (id: string) => PLACES.find((p) => p.id === id)!;
const bangkok = place("bangkok");
const tokyo = place("tokyo");

// 1. Adding, finding and removing ---------------------------------------
let list: Favorite[] = [];
list = addFavorite(list, bangkok);
list = addFavorite(list, tokyo);
list = addFavorite(list, bangkok);
assert.deepEqual(
  list.map((f) => f.place.id),
  ["bangkok", "tokyo"],
  "a place is saved once, in the order starred",
);

// "Use my location" a few hundred metres from the saved spot is the same favorite.
const located = placeForPoint({ lat: 13.7575, lon: 100.503 }, "Asia/Bangkok");
assert.notEqual(located.id, bangkok.id);
assert.equal(findFavorite(list, located)?.place.id, "bangkok");
assert.equal(addFavorite(list, located).length, 2);
const farAway = placeForPoint({ lat: 13.9, lon: 100.6 }, "Asia/Bangkok");
assert.equal(findFavorite(list, farAway), undefined, "a spot 20 km away is a different place");
assert.deepEqual(
  removeFavorite(list, located).map((f) => f.place.id),
  ["tokyo"],
);
console.log("✓ Places are saved once; a located spot within 1 km matches the saved one");

// 2. Names ------------------------------------------------------------------
list = renameFavorite(list, bangkok, { kind: "home" });
assert.equal(favoriteName(list[0], "en", MESSAGES.en), "Home");
assert.equal(favoriteName(list[0], "th", MESSAGES.th), "บ้าน");
list = renameFavorite(list, bangkok, { name: "Mum's", kind: null });
assert.equal(favoriteName(list[0], "th", MESSAGES.th), "Mum's", "a typed name is kept as typed");
list = renameFavorite(list, bangkok, { name: "   " });
assert.equal(list[0].name, undefined, "a blank name falls back to the place name");
assert.equal(favoriteName(list[0], "th", MESSAGES.th), "กรุงเทพฯ");
assert.equal(favoriteName(list[1], "en", MESSAGES.en), "Tokyo");
assert.equal(renameFavorite(list, tokyo, { name: "x".repeat(99) })[1].name?.length, 40);
console.log("✓ Home / Office follow the UI language; typed names are kept; blank names fall back");

// 3. Storage ------------------------------------------------------------------
list = renameFavorite(list, tokyo, { kind: "office" });
const restored = parseFavorites(serializeFavorites(list));
assert.deepEqual(restored, list, "a saved list reads back unchanged");

for (const raw of [null, "", "{not json", "[]", "null", '{"favorites":"nope"}', '{"favorites":[1,null,{}]}']) {
  assert.deepEqual(parseFavorites(raw), [], `broken storage ${JSON.stringify(raw)} gives an empty list`);
}
const mixed = parseFavorites(
  JSON.stringify({
    version: 1,
    favorites: [
      { place: { ...bangkok, name: "Old name", th: undefined }, kind: "home", savedAt: "2026-09-30T00:00:00.000Z" },
      { place: { id: "broken", name: "No point", country: "", timeZone: "UTC" } },
      { place: bangkok, kind: "castle" },
      { place: located, name: 42 },
    ],
  }),
);
assert.equal(mixed.length, 1, "malformed and duplicate entries are dropped");
assert.equal(mixed[0].place.name, "Bangkok", "catalog places pick up the catalog's current names");
assert.equal(mixed[0].place.th?.name, "กรุงเทพฯ");
const spot = parseFavorites(JSON.stringify({ favorites: [{ place: located }] }))[0];
assert.equal(spot.place.id, located.id, "a located spot keeps its own id and point");
assert.deepEqual(spot.place.point, located.point);
console.log("✓ Saved lists read back unchanged; broken or old data never breaks the page");

// 4. Where the app opens --------------------------------------------------------
const chiangMai = place("chiang-mai");
let saved: Favorite[] = [];
assert.equal(openingPlace(saved, bangkok), undefined, "no favorites: the app keeps its default place");
saved = addFavorite(addFavorite(saved, tokyo), chiangMai);
assert.equal(openingPlace(saved, null)?.id, "tokyo", "with nothing else to go on, the first favorite");
saved = renameFavorite(saved, chiangMai, { kind: "home" });
assert.equal(openingPlace(saved, null)?.id, "chiang-mai", "Home wins over the first favorite");
assert.equal(openingPlace(saved, tokyo)?.id, "tokyo", "the favorite on screen last time wins over Home");
assert.equal(openingPlace(saved, bangkok)?.id, "chiang-mai", "a last place that is not a favorite is ignored");
assert.equal(openingPlace(addFavorite(saved, located), bangkok)?.id, located.id, "a located favorite matches nearby");
assert.equal(parseLastPlace(JSON.stringify(tokyo))?.id, "tokyo");
for (const raw of [null, "", "{oops", "42", '{"id":"x"}']) assert.equal(parseLastPlace(raw), null);
console.log("✓ Opens on the favorite viewed last, else Home, else the first favorite");
