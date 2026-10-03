# DooFah ดูฟ้า · Look at the Sky

A hyper-local weather app with a glassmorphism UI, a sky that changes with the
weather, and an interactive top-view radar map. Forecasts are real: the Thai
Meteorological Department's WRF for the first two days in Thailand, then
ECMWF's IFS, through DooFah's own `/api/forecast`; air quality comes from
[Open-Meteo](https://open-meteo.com/). The radar map's layers (rain, cloud
cover, wind, temperature and pressure) are ECMWF's too, through `/api/fields`.
A simulated **WeatherNext 3** style model (5 km grid, hourly steps, 15-day
horizon) can run the whole dashboard, map included, with `?data=sim`.

- **Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Framer Motion, Lucide icons, Leaflet + react-leaflet with OpenStreetMap tiles.
- **No API keys needed to start.** ECMWF and air quality come from Open-Meteo's free API, and place search runs on the device; WRF needs TMD's token. See [Weather data](#weather-data) and [Route weather](#route-weather).
- **Thai and English.** A TH / EN switch in the header changes every label, forecast phrase, date and place name.
- **Favorite places.** Star any place and it joins a one-tap bar under the header, saved in the browser.
- **Installable app.** Add it to the home screen and it opens full screen like a native app, works offline, and is tuned for touch.
- **Two models, one forecast.** WRF for the first 48 hours, ECMWF after, and every hour says which. See [Unified forecast](#unified-forecast-wrf--ecmwf).
- **Route weather.** Pick where you are going and see the weather at each stop on the way, at the time you get there, on real roads.
- **Spoken summary.** A floating button reads a short weather summary aloud, in Thai or English.
- **Tropical cyclones.** Storm tracks and their cones from ECMWF's ensemble on the map, and a warning when one may pass within 500 km. See [Tropical cyclones](#tropical-cyclones).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script                | What it does                                                   |
| --------------------- | -------------------------------------------------------------- |
| `npm run dev`         | Development server                                             |
| `npm run build`       | Production build                                               |
| `npm start`           | Serve the production build                                     |
| `npm run lint`        | ESLint (Next.js core-web-vitals + TypeScript rules)            |
| `npm run typecheck`   | `tsc --noEmit`                                                 |
| `npm run verify:mock` | Shape, determinism, consistency and climate checks for the mock service |
| `npm run verify:i18n` | Every Thai phrase is Thai, Thai dates and Thai place search       |
| `npm run verify:favorites` | Saving, naming and reading back favorite places             |
| `npm run verify:alerts` | Alert thresholds, time windows, order and tips in both languages |
| `npm run verify:lifestyle` | Rain countdown timing and the lifestyle card rules          |
| `npm run verify:reports` | Crowd report simulation, fading, your reports and "verified" |
| `npm run verify:route` | Reading OSRM's replies (a real Koh Samui ferry route), the router's limits, stops along the way and the trip outlook |
| `npm run verify:voice` | Spoken times, voice choice and the summary for every place in both languages |
| `npm run verify:open-meteo` | Open-Meteo's air quality: the request, the AQI and the key proxy |
| `npm run verify:forecast` | The unified forecast: the ECMWF and TMD requests, which model each hour takes, the 48-hour blend, the condition rule, the days and `/api/forecast` |
| `npm run verify:forecast-service` | The screens on the unified forecast: the dashboard, a favorite's chip and trip stops from one reply per place, model tags, the hourly countdown and the offline copy |
| `npm run verify:weather-state` | The moment on the map's timeline: the forecast for it, the countdown from it, the radar frames between hours and their motion, and the labels in both languages |
| `npm run verify:fields` | The map's live layers: the lattice and its slots, the ECMWF request and reply for a tile, `/api/fields`, the frames from tiles, the same numbers as the forecast card, and the cloud layer's motion |
| `npm run verify:cyclones` | Tropical cyclones: the BUFR reader against ecCodes on ECMWF's own files, tracks as storms, the cone, the strength names, the storm alert, finding the newest run and `/api/cyclones` |
| `npm run icons`       | Re-render the app icons and favicon from `scripts/icons/doofah-icon.svg` |

Preview any sky mood with a query parameter:
`/?sky=thunderstorm`, `golden-hour`, `clear-night`, `heavy-rain`, `rain`,
`snow`, `fog`, `cloudy-day`, `cloudy-night`, `clear-day`.

Preview the alert banner the same way: `/?alert=storm`, `rain`, `air`, a
list such as `storm,air`, or `all`.

Preview the rain countdown with `/?rain=soon` (rain in 20 minutes), `now`
(heavy rain easing in 35 minutes), `later` (dry for 3 hours) or `dry`
(dry for a day). The lifestyle cards follow the previewed countdown.

Preview the cyclone layer and its warning with `/?cyclones=demo`: a sample
typhoon that passes about 160 km from the place on screen 30 hours from now.

Show the simulated WeatherNext 3 data instead of the live forecast with `/?data=sim`.
The parameters combine, e.g. `/?data=sim&sky=rain`.

## Weather data

| What | Where it comes from |
| ---- | ------------------- |
| Now, the 48-hour strip, 15 days, the rain countdown, alerts, lifestyle cards, the spoken summary, favorites' chips and the weather at each road trip stop | DooFah's [unified forecast](#unified-forecast-wrf--ecmwf) at `/api/forecast`: the Thai Meteorological Department's WRF for the first 40 to 48 hours in Thailand, then ECMWF's 9 km IFS from [Open-Meteo](https://open-meteo.com/en/docs/ecmwf-api) |
| Air quality (US AQI, PM2.5, PM10, ozone) | [Open-Meteo air quality API](https://open-meteo.com/en/docs/air-quality-api), from Copernicus CAMS |
| Radar map layers (rain, cloud cover, wind, temperature, pressure) | ECMWF's 9 km IFS from Open-Meteo, at points 14 to 445 km apart depending on the zoom, through `/api/fields`; see [Map layers from the model](#map-layers-from-the-model) |
| Tropical cyclone tracks, cones and the storm alert | ECMWF's ensemble cyclone tracks from [ECMWF open data](https://www.ecmwf.int/en/forecasts/datasets/open-data) (CC BY 4.0), through `/api/cyclones`; see [Tropical cyclones](#tropical-cyclones) |
| Road trip routes | [OSRM](https://project-osrm.org) over [OpenStreetMap](https://www.openstreetmap.org/copyright)'s roads, from FOSSGIS's public car router; see [Route weather](#route-weather) |
| Other people's weather reports and the "Verified by N local users" badge | Only with `?data=sim` until there is a shared backend; your own reports always show |

- **Environment variables.** The forecast needs none: DooFah's server asks
  Open-Meteo for ECMWF, and the browser asks `air-quality-api.open-meteo.com`
  for air quality. `TMD_API_TOKEN` adds WRF (see
  [Unified forecast](#unified-forecast-wrf--ecmwf)). Set `CONTACT_EMAIL` for
  the road router (see [Route weather](#route-weather)), and
  `GOOGLE_CLOUD_TTS_API_KEY` for the AI voice (see
  [Spoken weather summary](#spoken-weather-summary)). `OPEN_METEO_API_KEY`
  and `OSRM_URL` are optional.
- **Free API terms.** Non-commercial use only, with up to 10,000 calls a day,
  5,000 an hour and 600 a minute. ECMWF is asked by DooFah's server, so
  everyone using DooFah shares those calls: about 2 per place (rounded to
  about 1 km) per hour, since Vercel keeps each answer until the hour ends.
  The map's layers cost 36 calls per tile of points, once per 6 hours for
  everyone; a new area takes 4 to 16 tiles (see
  [Map layers from the model](#map-layers-from-the-model)).
  Air quality is asked by each visitor's browser, 1 call per place opened,
  reused for 5 minutes. The data is licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), so the footer
  credits ECMWF via Open-Meteo, and Copernicus.
- **`OPEN_METEO_API_KEY` (optional).** For commercial use (ads,
  subscriptions), buy an [Open-Meteo API plan](https://open-meteo.com/en/pricing)
  and set its key as `OPEN_METEO_API_KEY` in Vercel → Settings → Environment
  Variables, then redeploy. The server then asks Open-Meteo's customer
  servers for ECMWF, and the browser asks `/api/weather/air-quality`, which
  adds the key on the server (`src/services/openmeteo/proxy.ts`), so it
  never reaches the browser. It passes on only DooFah's own parameters for
  one place, refuses other sites, and lets Vercel answer the same request
  again for 5 minutes.
- **Offline.** The last forecast for up to 6 places is saved in
  `localStorage` (`doofah-offline-forecasts`, about 135 kB a place). With no
  connection the dashboard shows it for up to 2 days, says when it was
  downloaded, and offers a retry. Copies saved before the unified forecast
  (`doofah-saved-forecasts`) are cleared.
- **How the reply is read.** `src/services/forecast/ForecastService.ts` asks
  `/api/forecast` for each place, and `src/services/forecast/bundle.ts` turns
  the reply into the dashboard's shapes once, when it arrives. The
  dashboard, a favorite's chip and a road trip's stop read the same hours by
  the same rules: the temperature, humidity, wind and cloud between one hour
  and the next, the rain, its chance and the icon of the hour. So a
  favorite's chip shows what its dashboard shows, and the chip for the place
  on screen reuses the dashboard's reply.

## Unified forecast: WRF + ECMWF

DooFah reads exactly two weather models: WRF for the first 48 hours, ECMWF
after that, from `/api/forecast?lat=…&lon=…`. The dashboard, favorites'
chips and road trip stops read it, the dashboard through a shared
`useWeatherState` that also follows the map's timeline (below). The map's
layers read ECMWF from `/api/fields` ([Map layers from the model](#map-layers-from-the-model)).

| Hours from now | Model |
| -------------- | ----- |
| 0 to 42 | WRF, where WRF covers the place |
| 42 to 48 | WRF easing into ECMWF in six even steps |
| 48 to day 15 | ECMWF |

- **WRF** is the Thai Meteorological Department's WRF run, from TMD's NWP
  API (`src/services/forecast/tmd.ts`), for places in Thailand. It needs
  TMD's token as `TMD_API_TOKEN` in Vercel → Settings → Environment
  Variables, never in the code, for both Preview and Production (TMD's NWP
  API is TMD's open data service for developers; the project owner checked
  this on 3 October 2026), then redeploy for it to take effect. Without
  the token, outside Thailand, or while TMD fails, every hour is ECMWF and
  the reply says why (`wrf_missing`, and `wrf_reason` when TMD failed);
  answers without WRF because TMD failed are kept for only 5 minutes.
- **What WRF gives.** Temperature, humidity, pressure, rain, wind and cloud
  in three layers, every hour for 48 hours from now. Its gusts and
  visibility come from ECMWF (listed in `borrowed`). One request reaches 46
  hours (an hour's rain is in the next record), so for now WRF eases into
  ECMWF over hours 40 to 46; when a run ends early, the easing always moves
  up to its last 6 hours.
- **WRF's chance of rain.** A single WRF run has no chance of rain of its
  own; the real one needs WRF's grid (the share of nearby cells with rain),
  a later step. Until then it is worked out from WRF's own rain in the hour:
  10% when dry, 60% from 0.1 mm, 80% from 1 mm and 90% from 4 mm
  (`rainChanceFrom` in `src/services/forecast/condition.ts`), the same steps
  at which the icon changes. Never ECMWF's chance for WRF's rain.
- **Checked against the real TMD** on a Vercel preview (2 October 2026):
  WRF for hours 0 to 40, easing into ECMWF over 41 to 45. Still to check:
  that the rain at a time is for the hour before it, the cloud layers in
  percent, and TMD's exact area (Thailand is assumed).
- **ECMWF** is ECMWF's 9 km IFS from Open-Meteo, asked for on its own
  (`models=ecmwf_ifs`), never Open-Meteo's best match. DooFah's server asks
  for it, with `OPEN_METEO_API_KEY` when it is set. Its chance of rain is
  its 51-member ensemble's.
- **Each hour** carries `model_used`: `"WRF"`, `"ECMWF"`, or `"WRF+ECMWF"`
  with its `weights` during the easing. Each value is blended on its own,
  the wind by its east–west and north–south parts. A value the hour's model
  lacks is worked out from the hour's numbers (feels-like, dew point, UV
  from the sun's height and the cloud, the chance of rain from the rain) or
  taken from the other model and listed in `borrowed`. While easing, each
  model's own chance of rain is blended by the weights.
- **The condition** comes from the hour's numbers alone
  (`src/services/forecast/condition.ts`): rain from 0.1 mm, where the map's
  rain colours start, so once the map reads this forecast too, the card says
  rain exactly when the map shows it.
- **On the screens.** A chip on the hero card names this hour's model (WRF,
  ECMWF or WRF+ECMWF, with its resolution on hover), the hourly strip tags
  the hour where each model's hours start, and a day's details in the
  15-day list name its model (for today, the model of the hours still
  ahead, since hours already past are ECMWF's). The footer credits the WRF model to the Thai
  Meteorological Department (TMD), with a link to TMD, whenever the
  forecast has WRF hours, alongside ECMWF via Open-Meteo. The rain countdown steps an hour at a time, since neither
  model has real 15-minute steps over Thailand: its bars carry each hour's
  rain, and it names hours, never minutes ("Rain likely around 17:00", or
  "Rain possible" under a 50% chance).
- **Days** are summarised from their hours, and only whole days are listed,
  so there are 14 or 15 depending on how far the latest ECMWF run reaches.
- **Caching.** Places are rounded to 0.01° (about 1 km). Vercel keeps each
  answer until the hour ends, then serves it for up to 10 more minutes while
  it fetches a new one; the page reuses an answer for 5 minutes. Other
  sites' pages are refused, as for `/api/weather/air-quality`.
- **Not tested here against the real Open-Meteo or TMD**, which the sandbox
  can't reach; `npm run verify:forecast` and `npm run verify:forecast-service`
  use replies in their formats.

## The map's timeline and the shared moment

Every screen reads one place, one forecast and one moment from
`useWeatherState()` (`src/hooks/useWeatherState.tsx`):
`{ place, forecast, time, setTime, here, status }`. `time` is the moment
picked on the map's timeline, or `null` for now, and `here` is the
forecast as seen from that moment (`bundleAt` in
`src/services/forecast/bundle.ts`).

- **What follows the timeline.** The hero card says "Forecast for 18:00"
  (or "tomorrow 09:00") with a Back to now button, and its temperature,
  sky, rain countdown and 2-hour bars, the lifestyle cards, the details
  grid and the animated sky are for that moment. The air quality shows only
  within an hour of now, since it is a reading, not a forecast. Weather
  alerts, the spoken summary, favorites' chips, the hourly strip and the
  15 days stay on now. "Show on map" for a trip stop moves the whole
  dashboard to when you get there.
- **10-minute steps.** The timeline runs from 3 hours ago to 24 hours
  ahead in 10-minute steps: a drag or tap lands on one, arrows move 10
  minutes, Page Up / Page Down an hour, Home and End to the ends. Playback
  runs an hour a second, smoothly, and the cards follow it.
- **Rain and cloud move between hours.** The model gives a frame each hour.
  Between two, the rain (or the cloud cover) is moved along its own track
  rather than faded from one hour into the next
  (`src/components/radar/interpolate.ts`): the motion is found by matching
  the two hours from coarse to fine, and each in-between frame carries the
  first hour forward and the second back to meet. Where the two hours don't
  match well (rain forming or dying out) it fades instead. Wind,
  temperature and pressure fade between hours.
  While the timeline moves the rain is painted a little coarser, then
  finely once it stops.
- **Zoom.** The map zooms out to level 3, wide enough for a monsoon trough
  or a typhoon across the region, and in to 20. Zoomed out, the weather
  grid widens so it stays quick: ECMWF's points spread to 445 km apart over
  the middle 50° × 40° of the view, and the simulation's cells to about
  130 km.

## Map layers from the model

The map's five layers (rain, cloud cover, wind, temperature and sea-level
pressure) are ECMWF's IFS, the same model and the same hours as the
forecast cards after WRF's first two days. The layer switcher changes
layers at once, since every download carries all five, and every layer
follows the timeline, its 10-minute steps and playback.

- **Points on a lattice.** The map asks for ECMWF at points every 0.125°
  (14 km) close in, widening to 0.25°, 0.5°, 1°, 2° and 4° (445 km) as you
  zoom out, so there are about a dozen across the view
  (`src/services/fields/lattice.ts`). The points are counted from 0° N 0° E,
  so every view reuses the same ones, and they come in tiles of 6 × 6. The
  page draws them smoothly between points and fades them out at the edges.
  Zoomed out past 50° × 40°, the middle of the view gets layers.
- **Six-hour slots.** The day is cut into slots starting at 02, 08, 14 and
  20 UTC, about when each ECMWF run is out. `/api/fields?spacing=…&tile=row,col&slot=…`
  answers one tile with every hour from 3 hours before its slot to a day
  after it ends (`src/services/fields/http.ts`), so any moment in the slot
  finds the timeline's 3 hours back to a day ahead in it. Vercel keeps each
  tile until its slot is over, so Open-Meteo is asked for a tile once per
  slot, whoever looks. Only the current slot (or the one either side, for
  clocks that are a little off) is answered, and only for DooFah's own
  pages.
- **The same numbers as the cards.** A tile's hours follow the forecast's
  rules (`src/services/fields/ecmwfFields.ts`): rain is the amount in the
  hour from each time, and cloud, temperature, pressure and wind are at the
  time. `npm run verify:fields` checks that a point on the map reads what
  the ECMWF forecast for that spot reads. The map is ECMWF at 14 km and
  more between points, so at your exact spot it can differ from the card,
  which reads WRF's 3 km grid in Thailand for the first two days.
- **Quota.** Each point is one call of Open-Meteo's free daily 10,000, so a
  tile costs 36 calls once a slot. A view takes 4 to 16 tiles; zooming out
  step by step through every level takes about 24. The map waits until it
  rests before asking for a new area, so zooming through several levels
  asks only for the last. If Open-Meteo is busy, `/api/fields` answers 503
  and the map says "Map layers unavailable · retrying" and asks again a
  minute later. A busy site needs `OPEN_METEO_API_KEY`.
- **WRF on the map.** TMD's API answers for places, not grids, and TMD
  reserves all rights to its WRF grid files, so WRF joins the map only with
  TMD's permission.

## Setting it up from scratch

This is how the project was created, in case you want to rebuild it elsewhere:

```bash
npx create-next-app@latest doofah-weather-app --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
cd doofah-weather-app
npm install framer-motion lucide-react leaflet react-leaflet
npm install -D @types/leaflet tsx
```

Leaflet needs three things in a Next.js App Router project, and all are
already in place:

1. **Its stylesheet**, imported once in `src/app/layout.tsx`:
   `import "leaflet/dist/leaflet.css";`
2. **Client-only rendering.** Leaflet touches `window`, so
   `DooFahRadarMap.tsx` loads the map with
   `dynamic(() => import(".../RadarLeafletView"), { ssr: false })` from a client component.
3. **A tile source and attribution.** The map uses the standard
   `https://tile.openstreetmap.org/{z}/{x}/{y}.png` tiles, darkened with a CSS
   filter (`.doofah-tiles` in `globals.css`), and shows the required
   "© OpenStreetMap contributors" credit in the map panel. OpenStreetMap's
   public tiles are fine for development but have a
   [usage policy](https://operations.osmfoundation.org/policies/tiles/); for
   production traffic, point the `TileLayer` URL at a tile provider (for
   example MapTiler, Stadia or Carto) and keep the attribution.

Place search uses a small built-in gazetteer (Thai cities plus major world
cities), so no geocoding key is needed. The locate button uses the browser's
Geolocation API and snaps to the nearest known city within 40 km.

## Favorite places

- **Starring.** The star beside the place name saves the place you are looking
  at, and each search result has its own star, so you can save several places
  without leaving the search.
- **Naming.** Saving opens a small panel where you can type a name or pick
  **Home** or **Office**. Those two quick labels are stored as a kind rather
  than text, so they read บ้าน and ที่ทำงาน in Thai. With no name, the chip shows
  the place's own name in the current language.
- **Switching.** The bar under the header shows each favorite with its current
  temperature; one tap switches the dashboard to it. **Edit** shows a remove
  button on each chip.
- **Storage.** Favorites are saved in `localStorage` under `doofah-favorites`
  (`{ version: 1, favorites: [...] }`) and stay in step across open tabs.
  Unreadable or old data is skipped rather than breaking the page, and places
  from the gazetteer pick up its current names when read back. "Use my
  location" within 1 km of a saved place counts as that place.
- **Opening.** The app opens on a favorite instead of Bangkok: the favorite
  that was on screen last time (kept under `doofah-last-place`), else the one
  named Home, else the first in the bar. With no favorites it opens on Bangkok.

## Weather alerts

A banner at the top of the dashboard warns about weather worth acting on, each
with a few things to do (ควรพกร่ม, ควรสวมหน้ากากกันฝุ่น PM2.5, …). The rules
are in `src/lib/alerts.ts`:

| Alert | Shows when | Tips |
| ----- | ---------- | ---- |
| Thunderstorm | Storming now, or a thunderstorm hour in the next 2 hours | Stay indoors, keep away from open ground and tall trees, bring an umbrella, unplug electronics |
| Air quality | US AQI above 150; severe above 200 | Wear a PM2.5 mask, skip outdoor exercise, keep windows shut; when severe, sensitive groups stay indoors |
| Rain | Chance of rain above 80% in any hour of the next 3 hours | Bring an umbrella, allow extra travel time; watch for flooded roads if heavy rain is expected |

- A thunderstorm alert already covers the rain it brings, so the rain alert is
  left out while one is showing.
- Severe alerts come first and their icon pulses.
- The rain window is 3 hours so there is time to grab an umbrella before
  heading out; change `RAIN_WINDOW_HOURS` to widen or narrow it. With 2 hours
  the banner would miss rain that starts just after, and with 6 hours it would
  show for about a third of the day in the rainy season.
- The × hides an alert for that place until it gets worse (rain from later
  becomes rain now, or unhealthy air becomes very unhealthy).
- Air in Thailand is cleanest in the rainy season and worst around March, so
  AQI alerts are rare in September; `?alert=air` shows one. With no recent air
  quality reading there is no air alert.

## Tropical cyclones

A **Storms** switch at the end of the map's layer picker draws every active
tropical cyclone near the place: its most likely path, a cone that holds 2 in
3 of ECMWF's ensemble forecasts at each time, a dot every 12 hours (00 and
12 UTC) and the storm itself, moving with the map's timeline. Tap a dot or the
storm for its time, strongest wind, pressure, distance from the place and
when it comes closest. A chip under the picker lists the storms near the
place (tap one to fit it on the map), or says "No active tropical cyclones in
the region".

| Setting | Value | In `src/lib/cyclones.ts` |
| ------- | ----- | ------------------------ |
| Severe warning | The most likely path comes within 500 km in the next 48 hours | `ALERT_KM`, `SOON_HOURS` |
| Heads-up | Within 500 km later, up to 120 hours ahead | `AHEAD_HOURS` |
| Near the place (the switch turns on by itself, the chip lists it) | The path or the cone comes within 2,000 km in the next 120 hours | `REGION_KM` |
| Cone | Holds 2 in 3 of the ensemble members at each time | `CONE_SHARE` |
| Strength | Tropical depression under 34 knots (63 km/h), tropical storm under 64 knots (119 km/h), then typhoon, hurricane or cyclone by basin | `STORM_KMH`, `TYPHOON_KMH`, `basinOf()` |

- **The warning.** It goes at the top of the alert banner, after any other
  severe alert when it is only a heads-up. It names the storm, how close it
  comes and when, its strongest wind then, and the share of ECMWF's
  forecasts that bring it within 500 km. Tips: follow official warnings, tie
  down loose items, charge phones, avoid boat trips and the beach. "Show on map" fits the storm and the place on the map.
  When the place on screen is clear but a favorite isn't, the warning is for
  the nearest such favorite; other favorites in range are listed under it.
- **Which storms.** Only storms that a warning centre is tracking (ECMWF's
  file gives where they were observed) are shown. Storms that the model
  expects to form, numbered from 70 up, are left out.
- **The path.** ECMWF's high-resolution forecast where the file has it, else
  the ensemble's control, else the ensemble mean. Its wind is the strongest
  10 m wind near the centre.
- **Where it comes from.** ECMWF publishes the ensemble's cyclone tracks
  after each run as a BUFR file on
  [data.ecmwf.int](https://data.ecmwf.int/forecasts/) (`…/enfo/…-tf.bufr`; up
  to 360 hours from the 00 and 12 UTC runs, 144 hours from 06 and 18 UTC).
  `/api/cyclones` finds the newest run that has one (two runs in a row
  without one mean there are no storms), from ECMWF's portal or, when the
  portal refuses or fails, from the same files ECMWF keeps on
  [Google Cloud](https://storage.googleapis.com/ecmwf-open-data/), reads it
  with DooFah's own BUFR reader (`src/services/cyclones/bufr.ts`, no native
  libraries) and answers with every active storm: its path to 144 hours, the
  cone and each member's path. No key is needed. The data is
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), credited under
  the map.
- **Caching.** Vercel keeps the answer for 30 minutes and serves the old one
  while fetching a new one for up to 6 hours more, and the server keeps each
  run's file in memory for 12 hours, so ECMWF sees a few requests an hour
  however many people use DooFah. A failure is kept for a minute; the page
  says the tracks are unavailable and tries again.
- **Tables.** `src/services/cyclones/bufrTables.ts` holds the parts of WMO's
  BUFR tables the tracks use, made by `scripts/generate-bufr-tables.py`
  (`python3 -m pip install eccodes`, then run it): elements from the ecCodes
  library, and sequences from the same ecCodes release's definition files on
  GitHub, as WMO writes them. ECMWF's files today are one sequence per storm,
  3-16-082, with wind radii. If ECMWF starts using an element or sequence
  that isn't there, `/api/cyclones` answers 502 naming it, and the tables
  need regenerating.

## Rain countdown and lifestyle cards

The hero card opens its rain panel with a badge such as "Rain likely around
17:00" / "ฝนน่าจะตกราว 17:00 น." or "Clear sky for the next 3 hours". The
rules are in `src/lib/rainCountdown.ts`:

- **Live forecasts** step an hour at a time, so the badge names hours,
  never minutes. It is raining when this hour's forecast has rain (0.1 mm or
  more, as the icon shows), until the first dry hour. Otherwise rain comes
  from the first hour, looking 24 hours ahead, with rain or a 50% chance of
  it or more: within 2 hours it reads "Rain likely around 17:00" (or "this
  hour"), later "Rain likely from 17:00", and "Rain possible" when its
  chance is under 50%. The 2-hour bars show each hour's rain.
- **With the simulation** (`?data=sim`), the first 2 hours come from its
  10-minute radar nowcast: the start (or end) of rain is where the rate
  crosses 0.1 mm/h, interpolated between steps to the minute, and the badge
  counts down live every 15 seconds, with a marker on the rain bars and a
  "Radar" chip. After that the hourly forecast takes over: the first hour
  with a 50% chance of rain or more.
- A dry spell reads "Clear sky" when its cloud cover averages under 40%,
  otherwise "No rain".

Under the hero card (above the map on phones, a full row on wide screens) six cards
answer "is now a good time?". Each is good (green), take care (amber) or not
now (red), with the reason. The rules are in `src/lib/lifestyle.ts` and read
the same countdown as the badge, so they never disagree with it:

| Card | Red | Amber | Green |
| ---- | --- | ----- | ----- |
| Laundry | Raining, or rain within 4 hours | After dark or under 1.5 h of sun left; humidity 85% or more | Dry until sunset |
| Car wash | Raining, or rain within 12 hours or later today | 50%+ chance of rain tomorrow | Dry for the next days |
| Outdoor run | Thunderstorm within 2 h, AQI above 150, feels like 41 °C+ | Rain within the hour, feels like 36 °C+ (with the next cooler hour), AQI above 100, UV 8+ | Otherwise |
| Commute | Heavy rain or a storm now or within 3 hours | Any rain within 3 hours, visibility under 2 km | Otherwise |
| Sunscreen | UV 8+ still to come today | UV 3–7 | UV under 3, or the sun is down |
| Stargazing | Rain likely or 70%+ cloud in tonight's first 5 dark hours | 35–70% cloud | Under 35% cloud |

## Live weather reports from people nearby

Under the rain countdown, "What's the sky like where you are?" has four
buttons: Sunny (Clear after dark), Cloudy, Light rain and Heavy rain. One tap
sends a report.

- **On the map.** Your report shows next to your pin with a "You" tag.
  Other people's reports from the last hour show as small glass bubbles.
  - Each bubble has a ring that runs down over the hour. The bubble fades as
    the ring empties, and it leaves the map 60 minutes after the report was
    made.
  - Reports only show on the "now" end of the timeline, since they describe
    the last hour.
- **Changing your mind.** Tapping again within 10 minutes changes your report
  instead of adding a second one.
- **Mock backend.** `src/services/CrowdReportMockService.ts` plays the backend.
  Other people's reports and the badge below only show with `?data=sim`, since
  real ones need a shared backend.
  - Your reports are kept in localStorage, so they survive a reload.
  - Other people's reports are simulated from the same weather model as the
    radar. There are about six an hour within 30 km, more when it rains, and
    about one in eight picks the "wrong" button.
  - The same place and time always give the same reports.
- **"Verified by 5 local users".** This badge sits under the layer
  switcher while the rain layer is showing. The rule is in
  `src/lib/crowdVerify.ts`.
  - A report agrees with the radar when both say rain, or both say dry, at the
    report's spot and time.
  - The badge needs at least 2 people agreeing and at least 60% of the local
    reports.
  - When fewer than half agree, the badge says local users differ instead.

## Route weather

The "Route weather" card under the radar map shows the weather along a drive.

- **Where to.** Pick the start and the destination: your GPS location, the
  place on screen, a favorite, or search by name. The swap button turns the
  trip around. Leave now, or in 1, 2 or 3 hours.
- **The route.** [OSRM](https://project-osrm.org) works out the drive over
  OpenStreetMap's roads (`src/services/routing/osrm.ts`). By default the
  browser asks FOSSGIS's public car router at `routing.openstreetmap.de`, so
  the route follows real roads and car ferries, such as Don Sak to Koh Samui,
  which show dashed on the map with the time on board. A start or end over 5
  km from a road it can reach, an island with no car ferry, and a trip over
  2,500 km get a clear message instead of a line.
  - **FOSSGIS's terms** ([usage policy](https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/)):
    reasonable, non-commercial use; at most one request a second (DooFah
    spaces its requests 1.1 s apart and asks each trip once per visit); the
    OpenStreetMap credit and a "fix the map" link beside the route (both under
    the card); and an email address for the site's operator that is easy to
    find. Set it as `CONTACT_EMAIL` in Vercel and the footer shows it.
    Without `CONTACT_EMAIL` (or `OSRM_URL`), DooFah doesn't use FOSSGIS's
    router at all: the card says route planning isn't available yet.
  - **`OSRM_URL` (optional).** Another OSRM server's address, for example a
    self-hosted one for commercial use; FOSSGIS also asks that the address
    isn't hard-coded.
  - Routes need a connection; offline, the card says so. When the route comes
    back but the weather along it doesn't, the card says that instead, with
    "Try again".
  - A trip you give up on before its turn with the router (another
    destination, another departure time) is never asked.
  - Google's Routes API is not an option: its terms don't allow showing its
    routes on a non-Google map, and DooFah's map is OpenStreetMap.
- **Stops.** Every 15 minutes to 3 hours of driving, at most 10 stops. Each
  stop gets the [unified forecast](#unified-forecast-wrf--ecmwf) for that
  spot at the time you get there (`src/lib/routeWeather.ts`): `/api/forecast`
  once per place, 4 at a time. Stops are named after the
  nearest town within 40 km, otherwise by distance ("km 127").
- **Journey timeline.** Time, weather icon, temperature and chance of rain at
  each stop, joined by a line coloured by rain. A line above the timeline sums
  up the trip ("Heavy rain from Nakhon Sawan to Tak, 17:00–18:30") with a tip.
- **On the map.** The route is drawn on the radar, coloured by rain, with a
  weather bubble at each stop. Your car moves along it as the radar timeline
  plays. Tap a stop and the map flies there with the radar at that hour.

## Spoken weather summary

The "Play AI summary" button floats at the bottom right of the dashboard. It
reads a short summary of the weather aloud, and shows the words with the
current sentence highlighted.

- **What it says.** `src/lib/voiceSummary.ts` picks what is worth saying:
  - the weather now, and "feels like" when it is 3 °C or more off;
  - rain from the countdown ("Expect heavy rain around 5 PM, so you might
    want to bring an umbrella"), or how long it stays dry;
  - today's high before 3 PM, tonight's low and tomorrow after it;
  - strong UV, dangerous heat and unhealthy air.
- **How it says it.** Each language words it in its message file, the way
  people say it: "5 PM" and "ห้าโมงเย็น" rather than "17:00", units spelled
  out. The summary is written by rules on the device; no AI writes it.
- **The voice.** With `GOOGLE_CLOUD_TTS_API_KEY` set, an AI voice from
  [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech)
  reads it: Google's Chirp 3 HD voices, with native Thai (`th-TH`) and English
  (`en-US`) speakers (Aoede when Google has it, else another Chirp 3 HD voice,
  then older kinds). The card says "AI-generated voice · Google Cloud".
  - The page asks `/api/voice?lang=th-TH&text=…` for each sentence, all at
    once, and plays them one after another through Web Audio, so the
    highlight follows along. The server (`src/services/tts/googleTts.ts`)
    adds the key, which never reaches the browser.
  - Caching: the same sentence is answered by Vercel's edge for a week and by
    the browser for a day, without asking Google again; "Play again" uses the
    audio already downloaded. Greetings and common phrases are shared by
    everyone.
  - Guard rails: only DooFah's own pages (the browser's `Sec-Fetch-Site:
    same-origin`), Thai or English, 400 characters a sentence, 60 sentences a
    visitor in 10 minutes. Someone determined can still fake a browser, so
    cap the API's quota in Google Cloud (see below).
  - If the AI voice fails (no key, offline, Google down or out of quota), the
    device's own voice reads the rest, as before.
- **Without a key**, the browser's own speech (`window.speechSynthesis`)
  reads it. In Thai it asks for `th-TH` and picks the best Thai voice the
  device has (Kanya on iPhone and Mac, for example). If there is no Thai
  voice, the card says so and still shows the words.
- **Setting up the key.** In the [Google Cloud console](https://console.cloud.google.com):
  1. Pick or create a project with billing on, and enable the **Cloud
     Text-to-Speech API**.
  2. *APIs & Services → Credentials → Create credentials → API key*. Edit it:
     under *API restrictions* allow only the Cloud Text-to-Speech API.
  3. In Vercel, *Settings → Environment Variables*: add
     `GOOGLE_CLOUD_TTS_API_KEY` with the key, then redeploy.
  4. Optional but wise: lower the API's *Quotas* (characters per minute) and
     set a budget alert under *Billing*.
- **Cost.** Chirp 3 HD voices are free for the first 1 million characters a
  month, then US$30 per million (Google's price list, checked 2026-10-01). A
  summary is about 300 to 450 characters, so roughly 2,500 readings a month
  are free, and the edge cache makes repeats free.

## Home screen app (PWA)

**Installing.** On Android, Chrome offers **Install app** (or menu → *Add to
Home screen*). On iPhone and iPad, open the site in Safari and use Share →
*Add to Home Screen*. Desktop Chrome and Edge show an install button in the
address bar. The installed app opens full screen, draws its sky behind the
status bar and around the notch, and colours the browser bar to match the sky.

**Offline.** Once the page has loaded, the app opens without a connection and
shows the last forecast saved on the device (see [Weather data](#weather-data)).
`public/sw.js` keeps the page
(network first, falling back to the saved copy when offline or very slow), the
Next.js build files, the icons and the last 400 map tiles you looked at. It is
only registered in production builds (`npm run build && npm start`); in
development it removes itself. Bump `VERSION` in `sw.js` to drop saved pages on
the next visit; build files are content-hashed and need nothing.

**Files.** `src/app/manifest.ts` (served as `/manifest.webmanifest`),
`public/icons/*` and `src/app/{icon.svg,apple-icon.png,favicon.ico}` (all made by
`npm run icons`, including maskable versions for Android's round and squircle
shapes), and `public/screenshots/*` for the richer install dialog.

**Touch.**

- **Radar map.** The weather layers scale with the map during a pinch instead
  of jumping when it ends. Zoom is not snapped to steps, so a pinch or wheel
  zoom stays exactly where it was left, and double-click zoom stops cleanly at
  the closest zoom. Tapping for a reading never pans the map. On touch
  screens one finger scrolls the page and two fingers move and zoom the map,
  as on an embedded Google map, because the map fills most of a phone screen
  and would otherwise trap the scroll; a one-finger drag shows a short hint.
  The navigation-arrow button under the zoom buttons finds you by GPS, makes
  that the dashboard's place and flies the map there at zoom 13; without a fix
  it flies back to the marker and turns amber with the reason.
  The map zooms from level 3 (the whole region) to 20 (street level;
  OpenStreetMap tiles are enlarged past 19). The zoom buttons are 44 px on touch screens.
- **Vertical scrolling only.** `html` and `body` clip sideways overflow
  (`overflow-x: clip`, `hidden` as a fallback) with no sideways overscroll, the
  dashboard grids use `minmax(0, 1fr)` columns so no card can widen the page,
  and on phones under 448 px the map's layer switcher names only the picked
  layer. Sideways strips such as the hourly forecast still swipe.
- **Page zoom.** Like a native app, the page itself never zooms: the viewport
  sets `maximum-scale=1, user-scalable=no`, `html` has `touch-action: pan-x
  pan-y` (no pinch or double-tap zoom), and Safari's own `gesturestart` is
  cancelled in `AppProviders.tsx`. Only the radar map zooms, because Leaflet
  reads the touches itself. Mouse and trackpad work as
  before. To let one finger drag the map, remove `TouchGestures` from
  `RadarLeafletView.tsx`.
- **Timeline.** The thumb follows the finger smoothly and springs onto the
  nearest 10 minutes when released, with the time shown above the finger.
  Sideways drags scrub; up and down swipes still scroll the page. Tapping
  the track jumps to that time; dragging gives a light vibration on each
  whole hour. Keyboard: arrows (10 min), Page Up / Page Down (1 h), Home,
  End.
- **Feedback.** Buttons squeeze slightly when pressed (`TapButton`), picked
  layers pop, and choices give a short vibration (`src/lib/haptics.ts`): the
  Vibration API on Android and the system switch tick in Safari on iOS 18 and
  later. Animations follow the system's reduced-motion setting.

## Thai and English

- **Switching.** The TH / EN control in the header switches instantly and is
  remembered in a `doofah-locale` cookie, so the server renders the next visit
  in that language (`<html lang>`, page title and all). A first visit follows the
  browser's `Accept-Language`: Thai browsers get Thai, everyone else English.
- **Text.** All UI text lives in `src/i18n/messages/en.ts` and `th.ts`, typed by
  one `Messages` interface, so a missing Thai string is a type error. Components
  read it with `const { m, f } = useI18n()`.
- **Forecast phrases.** The service returns structured outlooks
  (`current.nowcast.outlook`, `day.outlook`) and each language words them
  itself, e.g. "Heavy downpours in the evening, breezy" and
  "ฝนตกหนักเป็นพัก ๆ ช่วงค่ำ ลมค่อนข้างแรง" come from the same outlook. The
  English `summary` fields are still there for API users.
- **Dates.** `Intl` with `th-TH` gives "30 ก.ย." and "14:05"; Thai day names are
  written out in full (จันทร์, อังคาร, … พฤหัสบดี) with วันนี้ / พรุ่งนี้ for the
  first two days.
- **Places.** Every gazetteer entry has Thai names (`place.th`), and search
  also takes Thai spellings and nicknames such as กทม, โคราช or สมุย.
- **Typography.** Thai characters use [Anuphan](https://fonts.google.com/specimen/Anuphan)
  (self-hosted by `next/font`), while Latin letters and digits stay in Geist so
  numbers look the same in both languages. Thai gets more line height so
  stacked vowels and tone marks never clip, and Thai labels drop the small caps
  and letter-spacing used for English ones. Language-specific styles use the
  `th:` variant defined in `globals.css`, e.g. `th:tracking-normal`.

## Project structure

```
src/
├── app/
│   ├── layout.tsx                 Fonts, language, metadata, viewport, Leaflet CSS
│   ├── page.tsx                   Renders the dashboard (reads ?sky=, ?alert=, ?rain=, ?cyclones= and ?data=)
│   ├── api/weather/air-quality/   Open-Meteo's air quality with the commercial key, if one is set
│   ├── api/voice/                 One sentence of the spoken summary as MP3 (Google Cloud Text-to-Speech, if a key is set)
│   ├── api/forecast/              The unified forecast (WRF + ECMWF) for one place, read by every card
│   ├── api/fields/                One tile of the map's layers (ECMWF) for a 6-hour slot
│   ├── api/cyclones/              Active tropical cyclones from ECMWF's newest track file
│   ├── manifest.ts                Web app manifest (install name, colours, icons)
│   ├── icon.svg, apple-icon.png, favicon.ico   App icons (from `npm run icons`)
│   └── globals.css                Glass surfaces, sky effects, touch rules, Leaflet styling
├── components/
│   ├── AppProviders.tsx           Language, reduced-motion setting, service worker registration
│   ├── DooFahDashboard.tsx        Page composition, place state, loading states
│   ├── DooFahHeader.tsx           Logo, animated search, geolocation button, language switch
│   ├── LanguageToggle.tsx         TH / EN switch
│   ├── WeatherAlertBanner.tsx     Storm, rain, air quality and tropical cyclone warnings with tips
│   ├── favorites/
│   │   ├── FavoritesBar.tsx       One-tap chips under the header, edit mode
│   │   ├── FavoriteStar.tsx       Star beside the place name and the naming panel
│   │   └── FavoriteIcon.tsx       House / briefcase / pin per favorite
│   ├── CurrentWeatherCard.tsx     Hero: temperature, feels-like, rain countdown, AQI, this hour's model (5×5 km badge with the simulation)
│   ├── RainCountdownPanel.tsx     Live time-to-rain badge over the 2-hour rain bars
│   ├── WeatherReportBar.tsx       One-tap Sunny / Cloudy / Light rain / Heavy rain reports
│   ├── VoiceSummaryButton.tsx     "Play AI summary" floating button and the words it reads
│   ├── route/
│   │   ├── RouteWeatherCard.tsx   Origin / destination, leave time, trip outlook, journey timeline
│   │   ├── PlaceField.tsx         Place picker: GPS, the current place, favorites, search
│   │   └── rainStyle.ts           Rain colours shared by the timeline and the map
│   ├── LifestyleIndex.tsx         Laundry, car wash, run, commute, sunscreen and stargazing cards
│   ├── DooFahRadarMap.tsx         Radar panel: layer switcher, timeline, legend, playback
│   ├── HourlyForecastSlider.tsx   48 h strip with sunrise/sunset markers
│   ├── DailyForecastList.tsx      15-day list, range bars, expandable day details
│   ├── WeatherDetailsGrid.tsx     Wind compass, humidity, UV, pressure, visibility, sun arc
│   ├── AtmosphereBackground.tsx   Animated sky per condition (rain, stars, lightning, …)
│   ├── radar/
│   │   ├── LayerSwitcher.tsx      Rain / Wind / Cloud / Temp / Pressure segmented control, and the Storms switch
│   │   ├── CycloneStatus.tsx      The storms near the place under the picker, or that there are none
│   │   ├── cycloneStyle.ts        A colour per storm strength
│   │   ├── TimelineScrubber.tsx   −3 h … +24 h touch scrubber in 10-minute steps, with play/pause
│   │   ├── interpolate.ts         Radar frames between hours: the rain's and cloud's motion and the frames along it
│   │   ├── ZoomButtons.tsx        Map zoom buttons, finger-sized on touch screens
│   │   ├── RecenterButton.tsx     Go to my location: GPS fix, then fly the map there
│   │   ├── CrowdVerifiedBadge.tsx "Verified by N local users" badge under the layer switcher
│   │   ├── RadarLegend.tsx        Colour legend per layer
│   │   ├── colorScales.ts         Radar, cloud, temperature, wind and pressure colour ramps
│   │   ├── isobars.ts             Marching-squares isobars + H/L centres
│   │   └── leaflet/
│   │       ├── RadarLeafletView.tsx   MapContainer, touch gestures, GPS marker, tap-to-probe
│   │       ├── useCanvasLayer.ts      Full-viewport canvas pane that follows pans, pinches and zooms
│   │       ├── FieldRasterLayer.tsx   Smooth colour field painted at screen resolution (rain, cloud, temperature, wind)
│   │       ├── WindParticleLayer.tsx  Animated wind streamlines
│   │       ├── ReportMarkers.tsx      People's reports as bubbles that fade over their hour
│   │       ├── RouteLayer.tsx         The trip: rain-coloured route, stop bubbles, your car
│   │       ├── CycloneLayer.tsx       Storm paths, cones, 12-hour dots and the storm at the map's time
│   │       ├── weatherGlyphs.ts       Lucide weather icons as SVG strings for map markers
│   │       └── IsobarLayer.tsx        Isobar lines, labels, H/L markers
│   └── ui/
│       ├── GlassCard.tsx          Translucent card with entrance animation
│       ├── TapButton.tsx          Button that squeezes when pressed, with optional haptics
│       ├── CycloneIcon.tsx        The storm symbol
│       └── WeatherIcon.tsx        Condition → Lucide icon, day/night aware
├── i18n/
│   ├── config.ts                  Locales, cookie name, Accept-Language matching
│   ├── server.ts                  The request's language (cookie, then browser)
│   ├── I18nProvider.tsx           useI18n(): messages, formatters, setLocale
│   ├── format.ts                  Times, Thai / English day names, short dates
│   ├── places.ts                  Place names and areas in the current language
│   ├── spokenTime.ts              Times and waits as people say them ("5 PM", "ห้าโมงเย็น")
│   └── messages/                  en.ts, th.ts and the Messages type
├── hooks/
│   ├── useForecast.ts             Loads + refreshes the forecast bundle
│   ├── useWeatherState.tsx        The place, its forecast and the moment on the map's timeline, for every screen
│   ├── useRadarFrames.ts          Loads frames for the visible map area from the forecast's source; the frame at any moment
│   ├── useFavorites.ts            Favorite places from localStorage, synced across tabs
│   ├── useGeolocation.ts          Browser location with status
│   ├── useNow.ts                  A shared clock that ticks every 15 s, for countdowns
│   ├── useCrowdReports.ts         Local reports (yours, and simulated ones with ?data=sim), and whether they back the radar
│   ├── useSpotWeather.ts          Weather at the favorites, from the forecast their dashboards read
│   ├── useRouteWeather.ts         Route card state: places, leave time, route and stop weather
│   ├── useSpeech.ts               Web Speech: voice choice, sentence by sentence, stop
│   ├── useVoiceReader.ts          The AI voice from /api/voice, the device voice as fallback
│   ├── useCyclones.ts             Active storms from /api/cyclones (or the sample storm), refreshed every 30 minutes
│   └── useWhen.ts                 "07:00 tomorrow" for a moment, in the place's time zone
├── lib/
│   ├── alerts.ts                  When to warn about storms, rain and air, and what to do
│   ├── cyclones.ts                Storm types, distances along a path, the cone, strength names and the cyclone warning
│   ├── cycloneDemo.ts             The sample storm for ?cyclones=demo
│   ├── colors.ts                  AQI and temperature colours
│   ├── favorites.ts               Favorite list rules and the localStorage store
│   ├── haptics.ts                 Short vibrations on Android and iPhone
│   ├── lifestyle.ts               Lifestyle card rules: good, take care or not now, and why
│   ├── rainCountdown.ts           Time to the next rain: by the hour for live forecasts, the radar nowcast with the simulation
│   ├── crowdVerify.ts             When local reports count as verifying the rain radar
│   ├── routeWeather.ts            Stops along a route, how wet each is, the trip outlook
│   ├── voiceSummary.ts            What the spoken summary says
│   ├── speech.ts                  Picking the best voice for a language
│   └── pwa.ts                     Service worker registration (production only)
└── services/
    ├── weatherService.ts          WeatherService: what the app asks of a weather source, and which one to use
    ├── openmeteo/
    │   ├── api.ts                 Endpoints, the values asked for and the reply types
    │   ├── air.ts                 Open-Meteo's air quality in DooFah's shape
    │   └── proxy.ts               Server side of /api/weather/air-quality: adds OPEN_METEO_API_KEY
    ├── fields/
    │   ├── lattice.ts             The map's points and 6-hour slots, shared by the page and the server
    │   ├── ecmwfFields.ts         ECMWF for one tile from Open-Meteo, by the forecast's hour rules
    │   ├── http.ts                Server side of /api/fields: checks, caching for the slot, errors
    │   └── FieldService.ts        The page's side: the tiles over the view as hourly frames
    ├── forecast/
    │   ├── ForecastService.ts     The live forecast for the page: /api/forecast per place, the map's layers, reuse, the offline copy
    │   ├── bundle.ts              /api/forecast's reply as the dashboard, a chip or a trip stop
    │   ├── point.ts               Places rounded to 0.01°, and the query for one
    │   ├── unified.ts             getUnifiedForecast(): asks both models, routes the hours, sums the days
    │   ├── router.ts              Which model each hour takes, the 48-hour blend, wind by its parts
    │   ├── condition.ts           The condition from an hour's numbers, shared with the map
    │   ├── ecmwf.ts               ECMWF's IFS from Open-Meteo in the router's units
    │   ├── tmd.ts                 WRF from TMD's NWP API (TMD_API_TOKEN) in the router's units
    │   ├── http.ts                Server side of /api/forecast: checks, caching, errors
    │   └── types.ts               The reply: hours and days with model_used
    ├── cyclones/
    │   ├── openData.ts            Finding the newest run's track file on ECMWF's portal (or its Google Cloud copy), kept for 12 hours
    │   ├── bufr.ts                A BUFR edition 3 and 4 reader (compressed or not)
    │   ├── bufrTables.ts          The WMO table entries it needs (generated)
    │   ├── ecmwfTracks.ts         ECMWF's track messages as storms: path, cone, members
    │   └── http.ts                Server side of /api/cyclones: checks, caching, errors
    ├── tts/
    │   └── googleTts.ts           Server side of /api/voice: Google Cloud Text-to-Speech
    ├── WeatherNext3MockService.ts The simulated API (start here)
    ├── CrowdReportMockService.ts  Mock backend for people's weather reports
    ├── routing/
    │   ├── routeService.ts        getRoute(): asks OSRM, spaced out and remembered
    │   ├── osrm.ts                OSRM's request and reply: the line, times and ferries
    │   ├── polyline.ts            Encoded polylines
    │   ├── towns.ts               Towns that name the stops
    │   └── types.ts               Route, request and error types
    └── weathernext3/
        ├── types.ts               All data contracts
        ├── describe.ts            English wording of nowcast and day outlooks
        ├── summarise.ts           Sky mood, day outlooks and the nowcast, for both sources
        ├── fieldModel.ts          The atmospheric field model
        ├── grid.ts                5 km grid snapping, radar grids, bilinear sampling
        ├── noise.ts               Seeded value noise / fBm
        ├── solar.ts               Sun elevation, sunrise and sunset (NOAA)
        ├── time.ts                IANA time-zone helpers (Intl only)
        └── places.ts              Offline gazetteer and search
public/
├── sw.js                          Service worker: offline page, build files, icons, map tiles
├── icons/                         Install icons, regular and maskable
└── screenshots/                   Phone and desktop screenshots for the install dialog
scripts/verify-mock-service.ts     Checks behind `npm run verify:mock`
scripts/verify-i18n.ts             Checks behind `npm run verify:i18n`
scripts/verify-favorites.ts        Checks behind `npm run verify:favorites`
scripts/verify-alerts.ts           Checks behind `npm run verify:alerts`
scripts/verify-lifestyle.ts        Checks behind `npm run verify:lifestyle`
scripts/verify-reports.ts          Checks behind `npm run verify:reports`
scripts/verify-route.ts            Checks behind `npm run verify:route`
scripts/fixtures/                  A real OSRM reply (Don Sak to Koh Samui by car ferry) for the route checks
scripts/verify-voice.ts            Checks behind `npm run verify:voice`
scripts/verify-open-meteo.ts       Checks behind `npm run verify:open-meteo`
scripts/verify-forecast.ts         Checks behind `npm run verify:forecast`
scripts/verify-forecast-service.ts Checks behind `npm run verify:forecast-service`
scripts/verify-weather-state.ts    Checks behind `npm run verify:weather-state`
scripts/verify-fields.ts           Checks behind `npm run verify:fields`
scripts/verify-cyclones.ts         Checks behind `npm run verify:cyclones`
scripts/fixtures/ecmwf-*.bufr      ECMWF sample BUFR files for the cyclone checks (see ECMWF-SAMPLES.md)
scripts/generate-bufr-tables.py    Writes src/services/cyclones/bufrTables.ts from ecCodes
scripts/generate-icons.ts          `npm run icons`, from scripts/icons/doofah-icon.svg
```

## The WeatherNext 3 mock service

```ts
import { weatherNext3, DEFAULT_PLACE } from "@/services/WeatherNext3MockService";

const { current, hourly, daily } = await weatherNext3.getForecastBundle(DEFAULT_PLACE);
current.sample.temperatureC;   // 2 m temperature at the 5 km cell
current.airQuality?.aqi;       // US EPA AQI from PM2.5, PM10 and O₃ (null for real data with no recent reading)
current.nowcast.summary;       // "Rain starting in about 40 min"
current.nowcast.outlook;       // { kind: "starting", minutes: 40, intensity: "moderate" }
hourly.length;                 // 48 (up to 360)
daily.length;                  // 15

const rain = await weatherNext3.getRadarFrames({
  layer: "precipitation",      // or "clouds" | "wind" | "temperature" | "pressure"
  bounds: [[12.5, 99.5], [15, 102]],
});
rain.frames.length;            // 28 hourly frames, −3 h … +24 h
rain.frames[3].rate;           // Float32Array of mm/h, row-major on rain.grid
```

| Method                          | Returns                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `getForecastBundle(place)`      | Current conditions, 48 hourly steps and 15 days in one call        |
| `getCurrentConditions(place)`   | Sample, AQI, sky theme, sunrise/sunset, 2-hour nowcast, model info |
| `getHourlyForecast(place, n)`   | `n` hourly steps with probabilities and confidence                 |
| `getDailyForecast(place, n)`    | Up to 15 local days with min/max, summary and 24 hourly steps each |
| `getRadarFrames(request)`       | Hourly grids for one layer over an area (cached)                   |
| `searchPlaces(query)`           | Gazetteer matches (English or Thai names)                          |
| `sampleAt(point, time)`         | Synchronous single sample                                          |
| `getWeatherAlong(stops)`        | One sample per `{ point, time }`, e.g. a trip's stops at their ETAs |
| `snapToGrid(point)`             | The 5 km × 5 km cell for a point                                   |

**How the simulation works.** Every variable is a continuous function of
latitude, longitude and time built from seeded noise that drifts with the
trade winds or westerlies, so storms move and evolve instead of flickering.
Pressure drives the wind (geostrophic balance plus friction). Moisture, low
pressure and afternoon heating drive convective and stratiform rain, which
drive cloud, which damps the daily temperature cycle. Because the hero card,
hourly strip, 15-day list and every radar frame read the same model, they
always agree. Rain chances come from a simulated ensemble spread that widens
with lead time and regresses toward climatology for days far ahead.

Options: `new WeatherNext3MockService({ seed, latencyMs, now })`. A fixed
`seed` and `now` give fully reproducible weather for tests and screenshots.

**Real data.** Components only depend on the types in
`services/weathernext3/types.ts` and the `WeatherService` interface in
`services/weatherService.ts` (`getForecastBundle`, `getWeatherAlong` and
`getRadarFrames`). `ForecastService` implements it for the live forecast and
the map's ECMWF layers, and `weatherService()` picks it or `weatherNext3` from
the page's `?data=` setting. Another source only needs the same three methods.
