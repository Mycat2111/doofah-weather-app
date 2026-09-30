/**
 * DooFah's multi-model rain forecast: every model in CONSENSUS_MODELS is
 * asked for the same place, and for each hour (and each day) they are
 * weighed against each other.
 *
 * Two kinds of evidence go in:
 *
 * - Each model's own rain. A model "votes" wet when it has at least 0.1 mm in
 *   the hour (the same line as Open-Meteo's chance of rain). Its vote counts
 *   by its `skill`, less when it only steps every 3 or 6 hours at that range
 *   (its rain is then spread evenly over the step, so its timing is blurred).
 * - Chances of rain from four or five ensembles (ECMWF's 51 runs, DWD's 40,
 *   NOAA's 31, Canada's 21...), weighted by the square root of their runs.
 *
 * The chance of rain is 60% the ensembles' and 40% the share of models that
 * vote wet. The confidence (0–1) needs two things at once (their geometric
 * mean): the sources agree with each other (1 minus twice their weighted
 * standard deviation), and the chance leans clearly towards rain or dry
 * weather (so 50% is never confident, however well they agree). Weights and
 * thresholds are DooFah's own choices, not a published method.
 *
 * What it cannot do: no model on Open-Meteo is finer than 9 km over
 * Thailand and none has true 15-minute steps there, so it says which hour,
 * not which minute, and never claims local high-resolution data.
 */

import { HOUR_MS } from "../weathernext3/time";
import type { ConfidenceLevel, ModelVote } from "../weathernext3/types";
import { CONSENSUS_MODELS, type ConsensusModel, type ConsensusResponse, type Values } from "./api";

/** Rain in an hour that counts as rain, mm. */
export const WET_MM = 0.1;
/** A day with this much rain counts as a rainy day, mm (the usual climate definition). */
export const WET_DAY_MM = 1;
/** Rain in an hour that counts as heavy, mm (as on route stops). */
export const HEAVY_MM = 4;
/** The ensembles' share of the chance of rain; the models' votes have the rest. */
export const ENSEMBLE_SHARE = 0.6;
/** Fewer models than this with a forecast, and their votes are not a source of their own. */
export const MIN_VOTERS = 3;
/** Confidence from this is "high", from MEDIUM "medium". */
export const HIGH_CONFIDENCE = 0.75;
export const MEDIUM_CONFIDENCE = 0.5;

export const confidenceLevel = (confidence: number): ConfidenceLevel =>
  confidence >= HIGH_CONFIDENCE ? "high" : confidence >= MEDIUM_CONFIDENCE ? "medium" : "low";

/**
 * How firmly the models back saying it will rain (`wet`) or stay dry: their
 * confidence when they lean that way, "low" when they lean the other way.
 */
export function support(vote: Pick<ModelVote, "chance" | "confidence">, wet: boolean): ConfidenceLevel {
  const leansWet = vote.chance >= 50;
  return leansWet === wet ? confidenceLevel(vote.confidence) : "low";
}

export interface Consensus {
  /** Each DooFah hour (its start, ms) that enough models cover. */
  hours: Map<number, ModelVote>;
  /** The models that answered. */
  models: ConsensusModel[];
}

const present = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The step, in hours, a model has `lead` hours ahead. */
const stepAt = (model: ConsensusModel, lead: number) => (lead < model.hourly ? 1 : model.steps);
/** The AI models have no thunderstorm codes (only rain and cloud go in). */
const forecastsThunder = (model: ConsensusModel) => !model.name.includes("(AI)");
const isThunder = (code: number | null | undefined) => present(code) && code >= 95 && code <= 99;

interface Evidence {
  /** Each model's vote: wet or not, and its weight. */
  votes: { wet: boolean; weight: number }[];
  /** Each ensemble's chance (0–1) and its runs. */
  ensembles: { chance: number; members: number }[];
}

/** The chance and confidence from a set of votes and ensemble chances, or null if there is too little to go on. */
export function weigh({ votes, ensembles }: Evidence): { chance: number; confidence: number } | null {
  const sources: { value: number; weight: number }[] = [];
  const voteWeight = votes.reduce((s, v) => s + v.weight, 0);
  const share = votes.length >= MIN_VOTERS && voteWeight > 0;
  const runWeight = ensembles.reduce((s, e) => s + Math.sqrt(e.members), 0);
  const ensembleShare = !ensembles.length ? 0 : share ? ENSEMBLE_SHARE : 1;
  for (const e of ensembles)
    sources.push({ value: e.chance, weight: (ensembleShare * Math.sqrt(e.members)) / runWeight });
  if (share)
    sources.push({
      value: votes.reduce((s, v) => s + (v.wet ? v.weight : 0), 0) / voteWeight,
      weight: 1 - ensembleShare,
    });
  // One source alone can't be checked against anything.
  if (sources.length < 2) return null;
  const chance = sources.reduce((s, x) => s + x.value * x.weight, 0);
  const spread = Math.sqrt(sources.reduce((s, x) => s + x.weight * (x.value - chance) ** 2, 0));
  const agreement = Math.max(0, 1 - 2 * spread);
  const leaning = Math.abs(2 * chance - 1);
  return { chance: Math.round(chance * 100), confidence: round2(Math.sqrt(agreement * leaning)) };
}

interface Columns {
  model: ConsensusModel;
  rain: Values;
  chance: Values | undefined;
  code: Values | undefined;
}

/**
 * The models' reply as votes for each DooFah hour. Open-Meteo gives the rain
 * of the hour *before* each time, so DooFah's hour from T reads the record at
 * T + 1 h (as the rest of the forecast does). `now` sets how far ahead each
 * hour is, which decides each model's step. Null when fewer than two models
 * answered.
 */
export function consensusFrom(raw: ConsensusResponse | null, now: number): Consensus | null {
  const h = raw?.hourly;
  if (!h?.time?.length) return null;
  const column = (name: string) => h[name] as Values | undefined;
  const columns: Columns[] = [];
  for (const model of CONSENSUS_MODELS) {
    const rain = column(`precipitation_${model.id}`);
    // A model that has stopped sends a column of nulls.
    if (!rain?.some(present)) continue;
    columns.push({
      model,
      rain,
      chance: model.ensemble ? column(`precipitation_probability_${model.id}`) : undefined,
      code: column(`weather_code_${model.id}`),
    });
  }
  if (columns.length < 2) return null;

  const index = new Map(h.time.map((t, i) => [t * 1000, i]));
  const thisHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hours = new Map<number, ModelVote>();
  for (const t of h.time) {
    const start = t * 1000;
    const i = index.get(start + HOUR_MS);
    if (i === undefined) continue;
    const lead = Math.max(0, Math.round((start - thisHour) / HOUR_MS));
    const evidence: Evidence = { votes: [], ensembles: [] };
    let heavy = 0;
    let storm = 0;
    let stormModels = 0;
    for (const { model, rain, chance, code } of columns) {
      const mm = rain[i];
      if (present(mm)) {
        const step = stepAt(model, lead);
        evidence.votes.push({ wet: mm >= WET_MM, weight: model.skill / Math.sqrt(step) });
        if (step === 1 && mm >= HEAVY_MM) heavy++;
        if (forecastsThunder(model) && present(code?.[i])) {
          stormModels++;
          if (isThunder(code?.[i])) storm++;
        }
      }
      const p = chance?.[i];
      if (present(p)) evidence.ensembles.push({ chance: Math.min(1, Math.max(0, p / 100)), members: model.ensemble });
    }
    const weighed = weigh(evidence);
    if (!weighed) continue;
    hours.set(start, {
      models: evidence.votes.length,
      wet: evidence.votes.filter((v) => v.wet).length,
      heavy,
      stormModels,
      storm,
      ensembles: evidence.ensembles.length,
      members: evidence.ensembles.reduce((s, e) => s + e.members, 0),
      ...weighed,
    });
  }
  if (!hours.size) return null;
  return { hours, models: columns.map((c) => c.model) };
}

/**
 * The models' view of a whole day from its hours' raw values: a model votes
 * wet with WET_DAY_MM or more in the day, each ensemble brings its highest
 * hourly chance. Null unless every hour of the day is in the reply.
 */
export function dayVote(raw: ConsensusResponse | null, hourStarts: number[]): ModelVote | null {
  const h = raw?.hourly;
  if (!h?.time?.length || !hourStarts.length) return null;
  const index = new Map(h.time.map((t, i) => [t * 1000, i]));
  const records = hourStarts.map((start) => index.get(start + HOUR_MS));
  if (records.some((i) => i === undefined)) return null;
  const rows = records as number[];
  const evidence: Evidence = { votes: [], ensembles: [] };
  let storm = 0;
  let stormModels = 0;
  for (const model of CONSENSUS_MODELS) {
    const rain = h[`precipitation_${model.id}`] as Values | undefined;
    const values = rows.map((i) => rain?.[i]);
    if (values.every(present)) {
      const total = (values as number[]).reduce((s, v) => s + v, 0);
      evidence.votes.push({ wet: total >= WET_DAY_MM, weight: model.skill });
      const codes = rows.map((i) => (h[`weather_code_${model.id}`] as Values | undefined)?.[i]);
      if (forecastsThunder(model) && codes.some(present)) {
        stormModels++;
        if (codes.some(isThunder)) storm++;
      }
    }
    if (!model.ensemble) continue;
    const chances = rows.map((i) => (h[`precipitation_probability_${model.id}`] as Values | undefined)?.[i]);
    if (chances.every(present))
      evidence.ensembles.push({
        chance: Math.min(1, Math.max(0, Math.max(...(chances as number[])) / 100)),
        members: model.ensemble,
      });
  }
  const weighed = weigh(evidence);
  if (!weighed) return null;
  return {
    models: evidence.votes.length,
    wet: evidence.votes.filter((v) => v.wet).length,
    heavy: 0,
    stormModels,
    storm,
    ensembles: evidence.ensembles.length,
    members: evidence.ensembles.reduce((s, e) => s + e.members, 0),
    ...weighed,
  };
}
