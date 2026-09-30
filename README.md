# DooFah ดูฟ้า · Look at the Sky

A hyper-local weather app with a glassmorphism UI, a sky that changes with the
weather, and an interactive top-view radar map. All data comes from a
simulated **WeatherNext 3** style forecast service: 5 km grid, hourly steps
and a 15-day horizon.

- **Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Framer Motion, Lucide icons, Leaflet + react-leaflet with OpenStreetMap tiles.
- **No API keys needed.** The forecast service and place search run entirely in the browser.
- **Thai and English.** A TH / EN switch in the header changes every label, forecast phrase, date and place name.
- **Favorite places.** Star any place and it joins a one-tap bar under the header, saved in the browser.
- **Installable app.** Add it to the home screen and it opens full screen like a native app, works offline, and is tuned for touch.

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
| `npm run icons`       | Re-render the app icons and favicon from `scripts/icons/doofah-icon.svg` |

Preview any sky mood with a query parameter:
`/?sky=thunderstorm`, `golden-hour`, `clear-night`, `heavy-rain`, `rain`,
`snow`, `fog`, `cloudy-day`, `cloudy-night`, `clear-day`.

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
  of jumping when it ends, and a pinch settles in quarter zoom steps. On touch
  screens one finger scrolls the page and two fingers move and zoom the map,
  as on an embedded Google map, because the map fills most of a phone screen
  and would otherwise trap the scroll; a one-finger drag shows a short hint.
  The zoom buttons are 44 px on touch screens. Mouse and trackpad work as
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
│   ├── page.tsx                   Renders the dashboard (reads ?sky=)
│   ├── manifest.ts                Web app manifest (install name, colours, icons)
│   ├── icon.svg, apple-icon.png, favicon.ico   App icons (from `npm run icons`)
│   └── globals.css                Glass surfaces, sky effects, touch rules, Leaflet styling
├── components/
│   ├── AppProviders.tsx           Language, reduced-motion setting, service worker registration
│   ├── DooFahDashboard.tsx        Page composition, place state, loading states
│   ├── DooFahHeader.tsx           Logo, animated search, geolocation button, language switch
│   ├── LanguageToggle.tsx         TH / EN switch
│   ├── favorites/
│   │   ├── FavoritesBar.tsx       One-tap chips under the header, edit mode
│   │   ├── FavoriteStar.tsx       Star beside the place name and the naming panel
│   │   └── FavoriteIcon.tsx       House / briefcase / pin per favorite
│   ├── CurrentWeatherCard.tsx     Hero: temperature, feels-like, nowcast, AQI, 5×5 km badge
│   ├── DooFahRadarMap.tsx         Radar panel: layer switcher, timeline, legend, playback
│   ├── HourlyForecastSlider.tsx   48 h strip with sunrise/sunset markers
│   ├── DailyForecastList.tsx      15-day list, range bars, expandable day details
│   ├── WeatherDetailsGrid.tsx     Wind compass, humidity, UV, pressure, visibility, sun arc
│   ├── AtmosphereBackground.tsx   Animated sky per condition (rain, stars, lightning, …)
│   ├── radar/
│   │   ├── LayerSwitcher.tsx      Rain / Wind / Temp / Pressure segmented control
│   │   ├── TimelineScrubber.tsx   −3 h … +24 h touch scrubber with play/pause
│   │   ├── ZoomButtons.tsx        Map zoom buttons, finger-sized on touch screens
│   │   ├── RadarLegend.tsx        Colour legend per layer
│   │   ├── colorScales.ts         Radar, temperature, wind and pressure colour ramps
│   │   ├── isobars.ts             Marching-squares isobars + H/L centres
│   │   └── leaflet/
│   │       ├── RadarLeafletView.tsx   MapContainer, touch gestures, user marker, 5 km cell, tap-to-probe
│   │       ├── useCanvasLayer.ts      Full-viewport canvas pane that follows pans, pinches and zooms
│   │       ├── FieldRasterLayer.tsx   Bicubic-smoothed raster (rain, temperature, wind speed)
│   │       ├── WindParticleLayer.tsx  Animated wind streamlines
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
│   └── messages/                  en.ts, th.ts and the Messages type
├── hooks/
│   ├── useForecast.ts             Loads + refreshes the forecast bundle
│   ├── useRadarFrames.ts          Loads frames for the visible map area
│   ├── useFavorites.ts            Favorite places from localStorage, synced across tabs
│   └── useGeolocation.ts          Browser location with status
├── lib/
│   ├── colors.ts                  AQI and temperature colours
│   ├── favorites.ts               Favorite list rules and the localStorage store
│   ├── haptics.ts                 Short vibrations on Android and iPhone
│   └── pwa.ts                     Service worker registration (production only)
└── services/
    ├── WeatherNext3MockService.ts The simulated API (start here)
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
