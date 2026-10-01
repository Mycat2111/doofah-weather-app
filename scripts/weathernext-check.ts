/**
 * Tries DooFah's WeatherNext 3 settings against the real BigQuery, from your
 * own computer, before they go into Vercel. Reads .env.local.
 *
 *   npm run weathernext:check                       Bangkok, dry runs only (free)
 *   npm run weathernext:check -- 18.79 98.98        Chiang Mai
 *   npm run weathernext:check -- 13.75 100.5 --run  also runs the query (billed like the app's)
 *
 * The dry runs check the credentials, the dataset and the column names, find
 * the newest run, and say how many bytes each query would scan (which is
 * what BigQuery bills), so you can see the cost before the app runs any.
 */
import { existsSync, readFileSync } from "node:fs";
import { floorHour, hoursFromWeatherNext, snapToCell } from "../src/services/weathernext/nowcast";
import {
  bigQueryWarehouse,
  LOOKBACK_HOURS,
  nearestCellRows,
  nowcastQuery,
  readConfig,
} from "../src/services/weathernext/server";

const HOUR = 3_600_000;
const GB = 1e9;
const TIB = 2 ** 40;
/** BigQuery on-demand price, US$ per TiB scanned after the free 1 TiB a month (checked 2026-10-01). */
const USD_PER_TIB = 6.25;

/** Fills process.env from .env.local, without overriding what is already set. */
function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function main() {
  loadEnvLocal();
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

  const cell = snapToCell(lat, lon);
  const now = Date.now();
  const store = await bigQueryWarehouse(config);
  console.log(`\nDry runs for the cell at ${cell.lat}, ${cell.lon} (free):`);
  const runs = Array.from({ length: LOOKBACK_HOURS + 1 }, (_, k) => floorHour(now) - k * HOUR);
  const sizes: number[] = [];
  for (const init of runs) {
    try {
      const bytes = await store.estimateBytes(nowcastQuery(config, cell, init, now));
      sizes.push(bytes);
      const when = new Date(init).toISOString().slice(0, 16).replace("T", " ");
      console.log(`  run ${when} UTC: ${bytes > 0 ? `${(bytes / GB).toFixed(3)} GB` : "not there yet"}`);
    } catch (error) {
      console.error(`\n✗ BigQuery refused the query:\n  ${error instanceof Error ? error.message : String(error)}`);
      console.error(
        "\n  Check that the service account has BigQuery Job User on the project and BigQuery Data Viewer on the dataset,\n" +
          "  that GCP_WEATHERNEXT_DATASET is the linked dataset's name, and (for an unknown column) WEATHERNEXT_RAIN_VARIABLE.",
      );
      process.exit(1);
    }
  }
  const newest = runs.findIndex((_, i) => sizes[i] > 0);
  if (newest < 0) {
    console.log(`\n✗ No WeatherNext 3 run in the last ${LOOKBACK_HOURS} hours. Is the BigQuery listing subscribed?`);
    process.exit(1);
  }
  const bytes = sizes[newest];
  const perQuery = (bytes / TIB) * USD_PER_TIB;
  // One place, asked once an hour all month; the first TiB each month is free.
  const monthly = bytes * 24 * 30;
  const billed = Math.max(0, monthly - TIB);
  console.log(
    `\nEach query scans about ${(bytes / GB).toFixed(3)} GB (US$${perQuery.toFixed(4)} beyond the free tier).`,
  );
  console.log(
    `One place every hour for a month: ${(monthly / TIB).toFixed(2)} TiB, ` +
      `${billed > 0 ? `about US$${((billed / TIB) * USD_PER_TIB).toFixed(2)} after the free 1 TiB` : "inside the free 1 TiB"}.`,
  );
  if (bytes > config.maxBytes) {
    console.log(
      `\n! That is over the ${(config.maxBytes / GB).toFixed(2)} GB cap, so the app will show Open-Meteo instead.` +
        "\n  Raise WEATHERNEXT_MAX_GB only if the monthly cost above is fine.",
    );
  } else {
    console.log("\n✓ Under the cap: the app will ask WeatherNext 3.");
  }

  if (!run) {
    console.log(`\nAdd --run to run the query itself (billed).`);
  } else {
    const rows = await store.rows(nowcastQuery(config, cell, runs[newest], now), config.maxBytes);
    const nearest = nearestCellRows(rows);
    const hours = nearest && hoursFromWeatherNext(nearest.rows, now);
    if (!nearest || !hours) {
      console.log(`\n✗ The run had ${rows.length} rows here but not all of the next 6 hours.`);
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
