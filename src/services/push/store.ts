/**
 * Where storm alert subscriptions live: Upstash Redis, connected from the
 * Vercel Marketplace, which adds KV_REST_API_URL and KV_REST_API_TOKEN
 * (UPSTASH_REDIS_REST_URL / _TOKEN work too, the same order @upstash/redis
 * uses). It answers over HTTPS, so serverless functions need no connection.
 *
 * Keys:
 * - `push:sub:<id>`: one phone's record (see subscription.ts); expires 60
 *   days after the phone last sent it, so phones that stopped opening
 *   DooFah drop out on their own.
 * - `push:subs`: the set of every id, so the send job can list them.
 * - `push:sent:<storm id>`: phone id → the level already sent for that
 *   storm, so each phone hears about a storm once as a warning and once more
 *   if it turns severe. Gone 21 days after the last send.
 * - `push:last-run`: when the send job last ran. Written on every run, which
 *   also keeps a free database from being archived as unused between storms.
 */

import { Redis } from "@upstash/redis";
import type { PushRecord } from "./subscription";

export type StormLevel = "warning" | "severe";

export interface PushStore {
  save(id: string, record: PushRecord): Promise<void>;
  get(id: string): Promise<PushRecord | null>;
  remove(id: string): Promise<void>;
  /** Every record, dropping ids whose record has expired. */
  all(): Promise<[string, PushRecord][]>;
  /** Phone id → level already sent, for one storm. */
  sent(stormId: string): Promise<Record<string, StormLevel>>;
  markSent(stormId: string, levels: Record<string, StormLevel>): Promise<void>;
  lastRun(): Promise<number | null>;
  setLastRun(time: number): Promise<void>;
}

export const RECORD_TTL_S = 60 * 86_400;
export const SENT_TTL_S = 21 * 86_400;
const INDEX = "push:subs";
const LAST_RUN = "push:last-run";
const recordKey = (id: string) => `push:sub:${id}`;
const sentKey = (stormId: string) => `push:sent:${stormId}`;
/** Keys per MGET, so each request stays small. */
const MGET_CHUNK = 100;

/** The store, or null when no Redis is connected (the push routes then answer 503). */
export function redisStore(env: Record<string, string | undefined> = process.env): PushStore | null {
  const url = (env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return null;
  return storeOn(new Redis({ url, token, enableTelemetry: false }));
}

export function storeOn(redis: Redis): PushStore {
  return {
    async save(id, record) {
      await redis.pipeline().set(recordKey(id), record, { ex: RECORD_TTL_S }).sadd(INDEX, id).exec();
    },
    async get(id) {
      return redis.get<PushRecord>(recordKey(id));
    },
    async remove(id) {
      await redis.pipeline().del(recordKey(id)).srem(INDEX, id).exec();
    },
    async all() {
      const ids = await redis.smembers(INDEX);
      const found: [string, PushRecord][] = [];
      const gone: string[] = [];
      for (let i = 0; i < ids.length; i += MGET_CHUNK) {
        const chunk = ids.slice(i, i + MGET_CHUNK);
        const records = await redis.mget<(PushRecord | null)[]>(...chunk.map(recordKey));
        chunk.forEach((id, j) => {
          const record = records[j];
          if (record) found.push([id, record]);
          else gone.push(id);
        });
      }
      if (gone.length) await redis.srem(INDEX, ...gone);
      return found;
    },
    async sent(stormId) {
      return (await redis.hgetall<Record<string, StormLevel>>(sentKey(stormId))) ?? {};
    },
    async markSent(stormId, levels) {
      if (!Object.keys(levels).length) return;
      await redis.pipeline().hset(sentKey(stormId), levels).expire(sentKey(stormId), SENT_TTL_S).exec();
    },
    async lastRun() {
      return redis.get<number>(LAST_RUN);
    },
    async setLastRun(time) {
      await redis.set(LAST_RUN, time);
    },
  };
}
