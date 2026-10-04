"use client";

import type { ReactNode } from "react";
import { SWRConfig, type Cache } from "swr";

/** Answers kept in the page; the least recently used go first. */
const KEPT = 12;

type Entry = Parameters<Cache["set"]>[1];

/** SWR's cache, holding only the most recently used answers. */
function recentOnly(): Cache {
  const entries = new Map<string, Entry>();
  return {
    keys: () => entries.keys(),
    get(key) {
      const entry = entries.get(key);
      if (entry !== undefined) {
        entries.delete(key);
        entries.set(key, entry);
      }
      return entry;
    },
    set(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > KEPT) entries.delete(entries.keys().next().value!);
    },
    delete(key) {
      entries.delete(key);
    },
  };
}

/** The page's SWR settings: answers for recently seen places stay in memory, so going back to one shows it at once. */
export function SwrProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: recentOnly }}>{children}</SWRConfig>;
}
