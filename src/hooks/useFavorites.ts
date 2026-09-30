"use client";

import { useSyncExternalStore } from "react";
import {
  addFavorite,
  favoritesStore,
  findFavorite,
  removeFavorite,
  renameFavorite,
  type FavoriteKind,
} from "@/lib/favorites";
import type { Place } from "@/services/WeatherNext3MockService";

const actions = {
  add: (place: Place) => favoritesStore.update((list) => addFavorite(list, place)),
  remove: (place: Place) => favoritesStore.update((list) => removeFavorite(list, place)),
  rename: (place: Place, change: { name?: string; kind?: FavoriteKind | null }) =>
    favoritesStore.update((list) => renameFavorite(list, place, change)),
};

/**
 * Starred places, saved in localStorage and kept in step across tabs.
 * Empty on the server and during hydration, then filled in on the client.
 */
export function useFavorites() {
  const favorites = useSyncExternalStore(
    favoritesStore.subscribe,
    favoritesStore.getSnapshot,
    favoritesStore.getServerSnapshot,
  );
  return {
    favorites,
    find: (place: Place) => findFavorite(favorites, place),
    ...actions,
  };
}
