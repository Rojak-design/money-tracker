# Money Tracker

A simple money tracker that runs in your phone's browser and can be installed on your home screen.
Plain HTML, CSS and JavaScript — no build step. **All data stays on your phone.**

## Features
- Multiple accounts (e.g. Savings, Spending) with a starting balance
- Log expenses and income: amount, category, date, note (tap an entry to edit or delete it)
- Categories for every transaction, with a category filter in History. Add, rename or remove categories under **Backup → Manage categories**.
- Daily reconciliation: attach a screenshot of your bank balance, type in the balance shown, and see the difference from the app's balance. Optionally add an adjustment to make them match, and choose which category the adjustment belongs to.
- **Plan** tab:
  - **Recurring** – instalments, loan repayments, subscriptions, rent, salary… (amount, how often, when it ends). Shows what's due in the next 30 days and how many payments are left. Log a payment from it, or link a transaction to it when adding one.
  - **Forecast** – the next 12 months of spending: recurring payments plus day-to-day spending (food, transport…) projected from your history, using the trend or the average of the last 3, 6 or 12 months. Tap a month for the breakdown.
  - **Projects** – save for a house, wedding, etc.: list the expected costs, what's saved (typed in or an account's balance) and how much you save each month, and see how many months it will take and whether you'll make a target date.
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
- `app.js` – accounts, transactions, categories, reconciliation, backup
- `plan.js` – recurring payments, savings projects and the forecast
- `manifest.json`, `sw.js`, `icon*.png`, `icon.svg` – make it installable and work offline

When you change any file, bump the version in `sw.js` (e.g. `money-tracker-v2` → `v3`) so phones pick up the update.
