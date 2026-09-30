# DooFah ดูฟ้า · Look at the Sky

A hyper-local weather app with a glassmorphism UI, a sky that changes with the
weather, and an interactive top-view radar map. All data comes from a
simulated **WeatherNext 3** style forecast service: 5 km grid, hourly steps
and a 15-day horizon.

- **Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Framer Motion, Lucide icons, Leaflet + react-leaflet with OpenStreetMap tiles.
- **No API keys needed.** The forecast service, place search and route planner run entirely in the browser.
- **Thai and English.** A TH / EN switch in the header changes every label, forecast phrase, date and place name.
- **Favorite places.** Star any place and it joins a one-tap bar under the header, saved in the browser.
- **Installable app.** Add it to the home screen and it opens full screen like a native app, works offline, and is tuned for touch.
- **Route weather.** Pick where you are going and see the weather at each stop on the way, at the time you get there.
- **Spoken summary.** A floating button reads a short weather summary aloud, in Thai or English.

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
| `npm run verify:route` | The simulated router, stops along the way and the trip outlook |
| `npm run verify:voice` | Spoken times, voice choice and the summary for every place in both languages |
| `npm run icons`       | Re-render the app icons and favicon from `scripts/icons/doofah-icon.svg` |

Preview any sky mood with a query parameter:
`/?sky=thunderstorm`, `golden-hour`, `clear-night`, `heavy-rain`, `rain`,
`snow`, `fog`, `cloudy-day`, `cloudy-night`, `clear-day`.

Preview the alert banner the same way: `/?alert=storm`, `rain`, `air`, a
list such as `storm,air`, or `all`.

Preview the rain countdown with `/?rain=soon` (rain in 20 minutes), `now`
(heavy rain easing in 35 minutes), `later` (dry for 3 hours) or `dry`
(dry for a day). The lifestyle cards follow the previewed countdown.

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
- The simulated air is clean in the rainy season and worst in March, so AQI
  alerts are rare in September; `?alert=air` shows one.

## Rain countdown and lifestyle cards

The hero card opens its rain panel with a badge such as "Rain expected in 20
min" / "ฝนจะตกในอีก 20 นาที" or "Clear sky for the next 3 hours". The rules are
in `src/lib/rainCountdown.ts`:

- The first 2 hours come from the 10-minute radar nowcast. The start (or end)
  of rain is where the rate crosses 0.1 mm/h, interpolated between steps to the
  minute, and the badge counts down live every 15 seconds. These times carry a
  "Radar" chip and a marker on the rain bars.
- After that the hourly forecast takes over: the first hour with a 50% chance
  of rain or more, looking 24 hours ahead. A dry spell reads "Clear sky" when
  its cloud cover averages under 40%, otherwise "No rain".

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
  - Your reports are kept in localStorage, so they survive a reload.
  - Other people's reports are simulated from the same weather model as the
    radar. There are about six an hour within 30 km, more when it rains, and
    about one in eight picks the "wrong" button.
  - The same place and time always give the same reports.
- **"Verified by 5 local users".** This badge sits under the Rain / Wind /
  Temp / Pressure switcher while the rain layer is showing. The rule is in
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
- **The route.** The phone works it out by itself, so it also works offline,
  over DooFah's simulated highway map: about 60 towns and the main roads of
  Thailand and its neighbours, the Koh Samui car ferry, and border crossings
  (`src/services/routing/`). The card is tagged "Simulated route".
  - Google's Routes API is not an option: its terms don't allow showing its
    routes on a non-Google map, and DooFah's map is OpenStreetMap.
- **Stops.** Every 15 minutes to 3 hours of driving, at most 10 stops. Each
  stop gets the WeatherNext 3 forecast for that spot at the time you get
  there (`src/lib/routeWeather.ts`). Stops are named after the nearest town
  within 40 km, otherwise by distance ("km 127").
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
  out. The summary is written by rules on the device; no AI service is called.
- **The voice.** The browser's own speech (`window.speechSynthesis`). In Thai
  it asks for `th-TH` and picks the best Thai voice the device has (Kanya on
  iPhone and Mac, for example). If there is no Thai voice, the card says so
  and still shows the words.

## Home screen app (PWA)

**Installing.** On Android, Chrome offers **Install app** (or menu → *Add to
Home screen*). On iPhone and iPad, open the site in Safari and use Share →
*Add to Home Screen*. Desktop Chrome and Edge show an install button in the
address bar. The installed app opens full screen, draws its sky behind the
status bar and around the notch, and colours the browser bar to match the sky.

**Offline.** The forecast model runs in the browser, so once the page has
loaded the whole app works without a connection. `public/sw.js` keeps the page
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
  The map zooms from level 5 to 20 (street level; OpenStreetMap tiles are
  enlarged past 19). The zoom buttons are 44 px on touch screens.
- **Vertical scrolling only.** `html` and `body` clip sideways overflow
  (`overflow-x: clip`, `hidden` as a fallback) with no sideways overscroll, the
  dashboard grids use `minmax(0, 1fr)` columns so no card can widen the page,
  and on phones under 380 px the map's layer switcher names only the picked
  layer. Sideways strips such as the hourly forecast still swipe.
- **Page zoom.** Like a native app, the page itself never zooms: the viewport
  sets `maximum-scale=1, user-scalable=no`, `html` has `touch-action: pan-x
  pan-y` (no pinch or double-tap zoom), and Safari's own `gesturestart` is
  cancelled in `AppProviders.tsx`. Only the radar map zooms, because Leaflet
  reads the touches itself. Mouse and trackpad work as
  before. To let one finger drag the map, remove `TouchGestures` from
  `RadarLeafletView.tsx`.
- **Timeline.** The thumb follows the finger smoothly and springs onto the
  nearest hour when released, with the hour shown above the finger. Sideways
  drags scrub; up and down swipes still scroll the page. Tapping the track
  jumps to that hour. Keyboard: arrows, Page Up / Page Down (6 h), Home, End.
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
│   ├── page.tsx                   Renders the dashboard (reads ?sky=, ?alert= and ?rain=)
│   ├── manifest.ts                Web app manifest (install name, colours, icons)
│   ├── icon.svg, apple-icon.png, favicon.ico   App icons (from `npm run icons`)
│   └── globals.css                Glass surfaces, sky effects, touch rules, Leaflet styling
├── components/
│   ├── AppProviders.tsx           Language, reduced-motion setting, service worker registration
│   ├── DooFahDashboard.tsx        Page composition, place state, loading states
│   ├── DooFahHeader.tsx           Logo, animated search, geolocation button, language switch
│   ├── LanguageToggle.tsx         TH / EN switch
│   ├── WeatherAlertBanner.tsx     Storm, rain and air quality warnings with tips
│   ├── favorites/
│   │   ├── FavoritesBar.tsx       One-tap chips under the header, edit mode
│   │   ├── FavoriteStar.tsx       Star beside the place name and the naming panel
│   │   └── FavoriteIcon.tsx       House / briefcase / pin per favorite
│   ├── CurrentWeatherCard.tsx     Hero: temperature, feels-like, rain countdown, AQI, 5×5 km badge
│   ├── RainCountdownPanel.tsx     Live time-to-rain badge over the radar's 2-hour rain bars
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
│   │   ├── LayerSwitcher.tsx      Rain / Wind / Temp / Pressure segmented control
│   │   ├── TimelineScrubber.tsx   −3 h … +24 h touch scrubber with play/pause
│   │   ├── ZoomButtons.tsx        Map zoom buttons, finger-sized on touch screens
│   │   ├── RecenterButton.tsx     Go to my location: GPS fix, then fly the map there
│   │   ├── CrowdVerifiedBadge.tsx "Verified by N local users" badge under the layer switcher
│   │   ├── RadarLegend.tsx        Colour legend per layer
│   │   ├── colorScales.ts         Radar, temperature, wind and pressure colour ramps
│   │   ├── isobars.ts             Marching-squares isobars + H/L centres
│   │   └── leaflet/
│   │       ├── RadarLeafletView.tsx   MapContainer, touch gestures, GPS marker, tap-to-probe
│   │       ├── useCanvasLayer.ts      Full-viewport canvas pane that follows pans, pinches and zooms
│   │       ├── FieldRasterLayer.tsx   Smooth colour field painted at screen resolution (rain, temperature, wind)
│   │       ├── WindParticleLayer.tsx  Animated wind streamlines
│   │       ├── ReportMarkers.tsx      People's reports as bubbles that fade over their hour
│   │       ├── RouteLayer.tsx         The trip: rain-coloured route, stop bubbles, your car
│   │       ├── weatherGlyphs.ts       Lucide weather icons as SVG strings for map markers
│   │       └── IsobarLayer.tsx        Isobar lines, labels, H/L markers
│   └── ui/
│       ├── GlassCard.tsx          Translucent card with entrance animation
│       ├── TapButton.tsx          Button that squeezes when pressed, with optional haptics
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
│   ├── useRadarFrames.ts          Loads frames for the visible map area
│   ├── useFavorites.ts            Favorite places from localStorage, synced across tabs
│   ├── useGeolocation.ts          Browser location with status
│   ├── useNow.ts                  A shared clock that ticks every 15 s, for countdowns
│   ├── useCrowdReports.ts         Local reports (yours and simulated), and whether they back the radar
│   ├── useRouteWeather.ts         Route card state: places, leave time, route and stop weather
│   └── useSpeech.ts               Web Speech: voice choice, sentence by sentence, stop
├── lib/
│   ├── alerts.ts                  When to warn about storms, rain and air, and what to do
│   ├── colors.ts                  AQI and temperature colours
│   ├── favorites.ts               Favorite list rules and the localStorage store
│   ├── haptics.ts                 Short vibrations on Android and iPhone
│   ├── lifestyle.ts               Lifestyle card rules: good, take care or not now, and why
│   ├── rainCountdown.ts           Time to the next rain from the radar nowcast, then the hourly forecast
│   ├── crowdVerify.ts             When local reports count as verifying the rain radar
│   ├── routeWeather.ts            Stops along a route, how wet each is, the trip outlook
│   ├── voiceSummary.ts            What the spoken summary says
│   ├── speech.ts                  Picking the best voice for a language
│   └── pwa.ts                     Service worker registration (production only)
└── services/
    ├── WeatherNext3MockService.ts The simulated API (start here)
    ├── CrowdReportMockService.ts  Mock backend for people's weather reports
    ├── routing/
    │   ├── routeService.ts        getRoute(): the route the app shows
    │   ├── SimulatedRouter.ts     Shortest drive over the simulated road map
    │   ├── roadNetwork.ts         Towns and roads of the simulated map
    │   └── types.ts               Route, request and error types
    └── weathernext3/
        ├── types.ts               All data contracts
        ├── describe.ts            English wording of nowcast and day outlooks
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
scripts/verify-voice.ts            Checks behind `npm run verify:voice`
scripts/generate-icons.ts          `npm run icons`, from scripts/icons/doofah-icon.svg
```

## The WeatherNext 3 mock service

```ts
import { weatherNext3, DEFAULT_PLACE } from "@/services/WeatherNext3MockService";

const { current, hourly, daily } = await weatherNext3.getForecastBundle(DEFAULT_PLACE);
current.sample.temperatureC;   // 2 m temperature at the 5 km cell
current.airQuality.aqi;        // US EPA AQI from PM2.5, PM10 and O₃
current.nowcast.summary;       // "Rain starting in about 40 min"
current.nowcast.outlook;       // { kind: "starting", minutes: 40, intensity: "moderate" }
hourly.length;                 // 48 (up to 360)
daily.length;                  // 15

const rain = await weatherNext3.getRadarFrames({
  layer: "precipitation",      // or "wind" | "temperature" | "pressure"
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

**Swapping in a real API.** Components only depend on the types in
`services/weathernext3/types.ts` and the service's public methods. A real
client that returns the same shapes can replace `weatherNext3` without UI
changes.
