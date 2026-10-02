# Steady: project notes

Personal-use iPhone PWA for tracking worries, symptoms, and a daily check-in. Plain HTML/CSS/JS, no framework or build step. All data stays on the device (IndexedDB). Working name "Steady" is a placeholder.

## Purpose
1. **Worry calibration:** log a worry with severity, likelihood, and a check-back date, then record whether it happened. Compare predicted vs. actual, and log "surprises" (bad things not worried about beforehand).
2. **Symptom episodes:** track onset, readings (temperature, severity), and resolution. For "maybe I'm getting a cold" episodes, record whether it became a real cold.
3. **Daily check-in:** sleep, caffeine, screen time, mood, stress, worry, headache, notes. Used to look for headache patterns and mood/worry relationships.
4. **Long-term plan:** after about a year, compare episode start times against an Apple Health export (see "Planned").

## Files
- `index.html`: shell, tab bar, hidden file input for import.
- `style.css`: light/dark via `prefers-color-scheme`, teal accent, safe-area insets.
- `app.js`: storage, views, events, insights, export/import.
- `sw.js`: service worker, network-first with cache fallback (cache name `steady-v1`; add new files to its `FILES` list).
- `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.

## Storage
IndexedDB database `steady`, version 1, four object stores. If the schema ever changes, bump the version and handle it in `onupgradeneeded`.

| Store | Key | Fields |
|---|---|---|
| `worries` | `id` | `text`, `severity` (1-10), `likelihood` (0-100), `created` (ISO), `resolveBy` ('YYYY-MM-DD'), `outcome` (null / 'true' / 'partial' / 'false'), `resolvedAt` |
| `surprises` | `id` | `text`, `severity`, `created` |
| `episodes` | `id` | `kind` (headache / cold / muscle / digestive / other), `detail`, `severity`, `start` (ISO), `end` (ISO or null), `outcome` (null / 'real' / 'nothing', cold only), `notes`, `readings[]` of `{t, temp (°F or null), severity, note}` |
| `checkins` | `date` ('YYYY-MM-DD', local) | `sleep` (decimal hours), `caffeine`, `screen`, `mood` (1-10 or null), `stress` (0-10 or null), `worry` (0-10 or null), `headache` (0-10), `notes`, `savedAt` |

## Decisions worth remembering
- **Optional sliders** (mood, stress, worry) start greyed out and save `null` until touched (input, change, or tap). This avoids default values polluting the data. Headache defaults to 0 and always saves.
- **Sleep** is entered as hours + minutes (`sleepH`, `sleepM`) but stored as decimal hours, so insights math is unchanged. Helpers: `hmToHours`, `hoursToHM`.
- **Worry scoring:** 'true' = 1, 'partial' = 0.5, 'false' = 0.
- **Insight thresholds** (to avoid over-reading small samples):
  - Worry accuracy shows a small-sample note under 15 resolved worries.
  - Headache-day comparison needs at least 3 headache days and 3 headache-free days.
  - Mood vs. sleep (under 7 h vs. 7 h or more) needs 5 days in each group.
  - Worry comparisons use "high" = 6 or above; both the same-day mood comparison and the next-day headache comparison need 5 days in each group.
- **Export:** JSON `{app: 'steady', version: 1, exportedAt, data}`, via the iOS share sheet when available, otherwise a download. **Import** merges by key and overwrites records with the same id.
- A backup nudge appears on the Today tab if the last export (`localStorage` key `steady.lastExport`) is over 30 days old or missing.
- The app requests persistent storage on load (`navigator.storage.persist()`); iOS may still evict storage, so exports matter.
- All user text is HTML-escaped before rendering.

## Deploying (GitHub Pages)
- Serves from a subpath (`username.github.io/repo/`); all paths are relative, so this should work.
- Open the URL in Safari (not an in-app browser), then Share, then Add to Home Screen.
- To update: replace the files in the repo. The service worker is network-first, so a refresh should pick up changes; if not, close and reopen the app.

## Known limits
- No notifications (iOS PWAs can't schedule them reliably). Use a Reminders-app alert for the daily check-in and a monthly backup.
- The check-in is only for today; there is no way to backfill past days yet.
- Temperatures are in °F only.
- Tested only with headless logic checks on seeded data; not yet verified in a real browser. Expect possible layout quirks on first use.

## Planned
- **Apple Health comparison (after about a year of data):** a Python script run on a computer. Inputs: Steady's JSON export and Health's `export.xml` (Health app, profile picture, Export All Health Data). For each episode start, compare overnight heart rate, resting heart rate, HRV, respiratory rate, and wrist temperature in the preceding days against a trailing baseline, and measure how often the same signals fired with no illness following. Expect few events (a handful of colds per year), so treat results as suggestive. Do any in-app version only if the retrospective check shows real signal, with no real-time alerts at first, to avoid feeding body-monitoring worry.
- **Ideas, not committed:** backfill past check-ins, CSV export for doctor visits, a longer-term trend view.
