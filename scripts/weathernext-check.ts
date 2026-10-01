/**
 * Tries DooFah's WeatherNext 3 settings against the real BigQuery, from your
 * own computer, before they go into Vercel. Reads .env.local the way Next does.
 *
 *   npm run weathernext:check                       Bangkok, free checks only
 *   npm run weathernext:check -- 18.79 98.98        Chiang Mai
 *   npm run weathernext:check -- 13.75 100.5 --run  also runs the query once (billed like the app's)
 *
 * The free checks read the table's layout, then dry-run the app's query for
 * the recent runs: that checks the credentials, the dataset and the column
 * names, and finds the newest run in BigQuery. The table is clustered by
 * `geography`, so a dry run gives an upper bound (the whole run), not what one
 * cell costs; --run reports what BigQuery really bills.
 */
import { loadEnvConfig } from "@next/env";
import { hoursFromWeatherNext, snapToCell } from "../src/services/weathernext/nowcast";
import {
  ARRIVAL_HOURS,
  bigQueryWarehouse,
  candidateRuns,
  nearestCellRows,
  nowcastQuery,
  readConfig,
  WEATHERNEXT_TABLE,
} from "../src/services/weathernext/server";

const GB = 1e9;
const TIB = 2 ** 40;
/** BigQuery on-demand price, US$ per TiB billed after the free 1 TiB a month (checked 2026-10-01). */
const USD_PER_TIB = 6.25;
/** One place asked once an hour for 30 days. */
const QUERIES_A_MONTH = 24 * 30;

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** A month of one query an hour at `bytes` each, in words. */
function monthly(bytes: number): string {
  const total = bytes * QUERIES_A_MONTH;
  const billed = Math.max(0, total - TIB);
  return (
    `${(total / TIB).toFixed(2)} TiB a month for one place every hour, ` +
    (billed > 0
      ? `about US$${((billed / TIB) * USD_PER_TIB).toFixed(2)} after the free 1 TiB`
      : "inside the free 1 TiB")
  );
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const args = process.argv.slice(2).filter((a) => a !== "--run");
  const run = process.argv.includes("--run");
  const lat = Number(args[0] ?? 13.7563);
  const lon = Number(args[1] ?? 100.5018);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Give the latitude and longitude as numbers");

  const settings = readConfig(process.env);
  if (!settings.ok) {
    console.error(`✗ ${settings.problem}. See "WeatherNext 3 nowcast" in the README.`);
    process.exit(1);
  }
  const { config } = settings;
  const token = process.env.WEATHERNEXT_OWNER_TOKEN?.trim() ?? "";
  console.log(`Table:            ${config.table}`);
  console.log(`Billed to:        ${config.projectId}`);
  console.log(`Service account:  ${config.credentials.client_email}`);
  console.log(`Rain column:      ${config.rainVariable}_p50 / _p90 / ...`);
  console.log(`Cost cap:         ${(config.maxBytes / GB).toFixed(2)} GB per query (WEATHERNEXT_MAX_GB)`);
  console.log(`Owner token:      ${token.length >= 24 ? "set" : "MISSING or shorter than 24 characters"}`);

  // The table's layout (free): hourly partitions let a dry run tell a run that hasn't arrived.
  try {
    const { BigQuery } = await import("@google-cloud/bigquery");
    const { client_email, private_key } = config.credentials;
    const client = new BigQuery({ projectId: config.projectId, credentials: { client_email, private_key } });
    const [project, dataset] = config.table.split(".");
    const [meta] = await client.dataset(dataset, { projectId: project }).table(WEATHERNEXT_TABLE).getMetadata();
    const unit = meta?.timePartitioning?.type ?? "none";
    console.log(`Partitioned by:   ${meta?.timePartitioning?.field ?? "?"}, ${String(unit).toLowerCase()}`);
    console.log(`Clustered by:     ${(meta?.clustering?.fields ?? []).join(", ") || "nothing"}`);
    if (unit !== "HOUR") {
      console.log(
        "\n! The runs aren't in hourly partitions, so a dry run can't tell which have arrived." +
          '\n  The app will find no affordable run and stay on Open-Meteo (see "Not verified here" in the README).',
      );
    }
  } catch (error) {
    console.log(`Table layout:     couldn't read it (${error instanceof Error ? error.message : String(error)})`);
  }

  const cell = snapToCell(lat, lon);
  const now = Date.now();
  const store = await bigQueryWarehouse(config);
  console.log(`\nDry runs for the cell at ${cell.lat}, ${cell.lon} (free):`);
  const runs = candidateRuns(now);
  const sizes: number[] = [];
  for (const init of runs) {
    try {
      const bytes = await store.estimateBytes(nowcastQuery(config, cell, init, now));
      sizes.push(bytes);
      const note = bytes > config.maxBytes ? "  (over the cap: skipped)" : "";
      console.log(
        `  run ${utc(init)} UTC: ${bytes > 0 ? `up to ${(bytes / GB).toFixed(2)} GB${note}` : "not in BigQuery yet"}`,
      );
    } catch (error) {
      console.error(`\n✗ BigQuery refused the query:\n  ${error instanceof Error ? error.message : String(error)}`);
      console.error(
        "\n  Check that the service account has BigQuery Job User on the project and BigQuery Data Viewer on the dataset,\n" +
          "  that GCP_WEATHERNEXT_DATASET is the linked dataset's name, and (for an unknown column) WEATHERNEXT_RAIN_VARIABLE.",
      );
      process.exit(1);
    }
  }
  console.log(
    `  (A run reaches BigQuery about ${ARRIVAL_HOURS}½ hours after it starts, so runs after ${utc(runs[0])} UTC aren't asked yet.)`,
  );
  const present = runs.map((init, i) => ({ init, bytes: sizes[i] })).filter((r) => r.bytes > 0);
  if (!present.length) {
    console.log("\n✗ None of these runs is in BigQuery. Is the BigQuery listing subscribed and linked?");
    process.exit(1);
  }
  const chosen = present.find((r) => r.bytes <= config.maxBytes);
  const largest = Math.max(...present.map((r) => r.bytes));
  console.log(
    `\nA dry run on this table prices the whole run, an upper bound: BigQuery only skips the rest of the grid` +
      `\nwhen the query really runs. If it didn't skip anything, the most it could cost is ${monthly(chosen?.bytes ?? largest)}.`,
  );
  if (!chosen) {
    console.log(
      `\n! Every run is over the ${(config.maxBytes / GB).toFixed(2)} GB cap, so the app will show Open-Meteo.` +
        `\n  BigQuery refuses a query on this table when that upper bound is over maximumBytesBilled, so the cap` +
        `\n  must be above it: set WEATHERNEXT_MAX_GB to about ${Math.ceil(Math.min(...present.map((r) => r.bytes)) / GB) + 2}.`,
    );
  } else {
    console.log(`\n✓ Run ${utc(chosen.init)} UTC is under the cap: the app will ask WeatherNext 3.`);
  }

  if (!run || !chosen) {
    if (chosen) console.log("\nAdd --run to run the query once and see what BigQuery really bills (billed).");
  } else {
    const answer = await store.rows(nowcastQuery(config, cell, chosen.init, now), config.maxBytes);
    if (answer.bytesBilled !== null) {
      console.log(
        `\nBilled for this query: ${(answer.bytesBilled / 1e6).toFixed(1)} MB. At that rate: ${monthly(answer.bytesBilled)}.`,
      );
    }
    const nearest = nearestCellRows(answer.rows);
    const hours = nearest && hoursFromWeatherNext(nearest.rows, now);
    if (!nearest || !hours) {
      console.log(`\n✗ The run had ${answer.rows.length} rows here but not all of the next 6 hours.`);
      process.exit(1);
    }
    console.log(`\nNext 6 hours at the cell ${nearest.cell.lat}, ${nearest.cell.lon}:`);
    for (const h of hours) {
      const bound = h.chanceBound === "at-least" ? "≥" : h.chanceBound === "at-most" ? "<" : "";
      console.log(
        `  ${h.time.slice(11, 16)} UTC  chance ${bound}${Math.round((h.chance ?? 0) * 100)}%  ` +
          `median ${h.p50Mm} mm  90th percentile ${h.p90Mm} mm  mean ${h.meanMm} mm`,
      );
    }
  }
  console.log(
    `\nTo see it in the app, open https://<your site>/api/weathernext/access?token=<WEATHERNEXT_OWNER_TOKEN> once on your phone.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
