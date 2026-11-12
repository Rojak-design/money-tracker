# Money Tracker

A simple money tracker that runs in your phone's browser and can be installed on your home screen.
Plain HTML, CSS and JavaScript — no build step. **All data stays on your phone.**

## Features
- Multiple accounts (e.g. Savings, Spending) with a starting balance
- Log expenses and income: amount, category, date, note (tap an entry to edit or delete it)
- Daily reconciliation: attach a screenshot of your bank balance, type in the balance shown, and see the difference from the app's balance. Optionally add an adjustment to make them match.
- Export / Import a backup file (includes screenshots)
- Works offline, has light and dark mode

## Publish with GitHub Pages
1. On GitHub, open this repository → **Settings** → **Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**.
3. Choose the branch (e.g. `main`) and folder **/ (root)**, then tap **Save**.
4. Wait 1–2 minutes and refresh. Your link appears at the top: `https://<your-username>.github.io/money-tracker/`

## Install on your phone
- **iPhone (Safari):** open the link → Share button → **Add to Home Screen**.
- **Android (Chrome):** open the link → ⋮ menu → **Install app** / **Add to Home screen**.

## Important: back up regularly
Your data is stored only in this browser on this phone. If you delete the app, clear browser data,
or lose your phone, the data is gone. Use **Backup → Export backup** and save the file somewhere safe.
On iPhone, the home-screen app and Safari keep separate data — use the home-screen app consistently.

## Files
- `index.html` – the page
- `style.css` – the look
- `app.js` – everything the app does
- `manifest.json`, `sw.js`, `icon*.png`, `icon.svg` – make it installable and work offline

When you change any file, bump the version in `sw.js` (`money-tracker-v1` → `v2`) so phones pick up the update.
