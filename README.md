# Rojak

Rojak is a home screen that links to separate mini apps (modules). It runs in your phone's browser and can be
installed on your home screen. Plain HTML, CSS and JavaScript — no build step. **All data stays on your phone.**

## Home screen
- **Money** card: what you spent today and your net total (the same total as on the Accounts screen: bank accounts minus the card bills due this month / pay cycle). Tap it to open the money tracker.
- **Habits, Fitness, Books / Music, Scheduler**: placeholders for modules to be built later.
- **Backup** (for the whole app, every module at once):
  - **Export backup**: one file with everything in Rojak (Money, Fitness…). Screenshots are never included, so the file stays small.
  - **Restore from backup**: shows what's in the file and what's on the phone for each module, and lets you tick which modules to bring back; the ticked ones are replaced, the others stay as they are. Older Money backup files (`money-backup-….json`) and earlier Rojak backups restore too (their screenshots are skipped).
  - **Undo restore / Undo delete**: a copy of everything (without screenshots) is kept just before each restore or delete, so the last one can be undone.
  - **Delete saved screenshots**: bank screenshots saved by earlier versions of Money stay on the phone until you delete them here (shown only when there are some).
  - **Delete all data**: deletes every module's data (asks twice; can be undone, except screenshots).
  - A module screen left open while you restore or delete reloads with the new data instead of saving its old data over it.
- She and her cat peek over the top of the Money card. Every month her hair colour changes and the cat is a different breed (Siamese, Scottish Fold, Orange tabby, Persian, Calico, Maine Coon, Russian Blue, Bengal, Sphynx, Black cat, Tuxedo, Ragdoll). Each time you open the app she waves and blinks while the cat swishes its tail; tap either one to see it again. With Reduce Motion turned on, they stay still. The browser tab shows her with this month's hair; the icon on your phone's home screen stays teal (phones don't let a web app change it after it's installed).

## Shared data store
The home screen and every module save through one store (`core/store.js`). Every entry (account, transaction,
reconciliation, recurring payment, project, trip, workout…) is saved with `savedAt` (when it was first saved) and
`updatedAt` (when it last changed), so modules can be compared later. Entries saved before Rojak were given
their best-guess date the first time the money tracker opened (when the account was created, or the entry's
own date). The money tracker's data stays where it always was, so earlier data and backups still load. Other modules are saved under `mod:<module>`. Screenshots are read for their numbers and then thrown away, never kept.

## Money module (money tracker)
- Multiple accounts (e.g. Savings, Spending) with a starting balance **as of a date**; entries dated before it (e.g. past trips added later) are kept for history and charts but don't change the balance
- **Transfers** between your own accounts (e.g. salary to a savings account): **⇄ Transfer** on the Accounts screen. A transfer is two linked entries (out of one account, into the other), never counted as spending or income; tap either one in History to edit or delete it. Paying a card bill is a transfer to the card. Regular transfers (e.g. part of your salary into savings every payday) can be set up under Plan → Recurring → **Transfer**; they're listed with what's due and can be logged in one tap.
- Credit cards: log purchases on a card, see what you owe, what you spent this month and last, the next due date and available credit. **Pay card bill** moves money from a bank account to the card (not counted as spending). Reconcile a card by typing the amount owed shown by your bank. Set the card's statement closing day and due day so bills are worked out per statement cycle. On the Accounts screen a card shows **what's due this month / pay cycle** (its bills due in it, less what you've paid), and the net total takes off only that, so the numbers match this period's finances; a bill due in the next pay cycle shows up when that cycle starts. Tap the card for everything owed on it and each statement. Each statement (on the card's screen and in the forecast) adds up: the amount owed you entered, if its "owed as of" date falls in that statement; spending logged on the card; planned entries; and recurring payments on the card due in it, even if not logged yet (past ones not logged are listed with **Log it**). Card payments (from the card's "owed as of" date on, including that day) pay off the oldest bill first — starting with the amount you entered when setting up the card — and anything extra carries on to the next bill, so once everything is paid each bill shows 0 left.
- Log expenses and income: amount, category, date, note (tap an entry to edit or delete it). Entries dated in the future (e.g. PayLater instalments logged ahead) are **planned**: they're tagged in History, don't affect today's balances, and are added to the forecast in the period (and card bill) they fall in.
- **Fill from a screenshot**: when adding a transaction, pick a screenshot (receipt, payment confirmation, ride…) and the app reads the amount paid and a note for what it was (well-known merchants like TADA, Grab, FairPrice also set the category). Other amounts and notes found are offered to tap; everything stays editable. Reading happens on the phone.
- **Money back**: log refunds, or a friend paying you back for something you paid for, against the spending category it was for (e.g. Food). It goes into the account like income but is taken off that category, so category totals, the pie chart and the forecast show what you spent yourself.
- Categories for every transaction, with a category filter in History. History also has a pie chart of spending by category for this month (or pay cycle), with ‹ › to look at earlier ones (or later ones with planned entries); the transaction list below shows the same month / pay cycle as the chart (tap **Show all dates** to see everything). Tap a category to see its transactions. Add, rename or remove categories under **Settings → Manage categories**.
- Daily reconciliation: attach a screenshot of your bank balance and the app **reads the balance from it** (on your phone, nothing is uploaded; the screenshot itself isn't kept) — it fills in the amount next to “Available/Current/Outstanding balance” and lets you tap another amount or type it if it's wrong — and see the difference from the app's balance. Optionally add an adjustment to make them match, and choose which category the adjustment belongs to.
- **Plan** tab:
  - **Recurring** – instalments, loan repayments, subscriptions, rent, salary… (amount, how often, when it ends). Shows what's due in the next 30 days and how many payments are left. Log a payment from it, or link a transaction to it when adding one.
  - **Loans** – a recurring payment can end "when a loan is paid off": enter what's still owed today, the repayment and the interest (already included in what's owed, or charged on what's left at a yearly rate). The app works out the payoff date, payments left, total to pay and interest, and lists loans with what's owed on the Accounts screen.
  - **Trips** – add past trips and future travel plans (country, dates, optional budget). Spending logged during a trip is linked to it automatically (or pick the trip for flights and hotels booked earlier). Money back from others (e.g. friends paying you back) can be linked to a trip — the app suggests the trip when it comes in after you're back — and is taken off the trip's spending, so each past trip shows your own share. Each past trip shows what it cost per day and booked ahead, by category; **Travel budgets from past trips** gives those per country, and future trips are estimated from them (same country if you've been, otherwise all trips). The forecast includes each trip on its dates, and keeps trip spending out of your everyday trends.
  - **Forecast** – the next 12 months of spending: recurring payments plus day-to-day spending (food, transport…) projected from your history, using the trend or the average of the last 3, 6 or 12 months. Tap a month for the breakdown. Switch to **Savings** to see how much you can save each month or pay cycle (expected income − spending), the total over 12 months, how that fits your savings projects, and where your bank balance is heading. If you use credit cards, each month or pay cycle also shows the card bills due in it (worked out from each card's statement cycle) and the cash leaving your bank accounts.
  - **Projects** – save for a house, wedding, etc.: list the expected costs, what's saved (typed in or an account's balance) and how much you save each month, and see how many months it will take and whether you'll make a target date. Each cost can have the month it's needed and be paid in monthly instalments (e.g. a sofa in 12 payments from July); the app then works out how much to save each month — either as payments come due (e.g. S$5,500 in Jan, then S$500 a month for instalments) or spread out ahead of big payments (e.g. S$1,833.34 a month until Jan, then S$500) — and updates it when costs or savings change. You can still choose a fixed amount instead. When you buy something, link the expense to the project's cost (or tap **Log a payment** on it): the project shows what was paid against the plan, counts instalments paid, and works out what's left. Each cost can list options — vendor / brand, a link to the product (tap **Open ↗**), price and note — and you can use an option's price as the plan.
- Pay cycles: set your payday under **Settings** (optionally moved to the Friday before when it falls on a weekend). The forecast, its chart and the category totals in History then use pay cycles (payday to the day before the next payday) instead of calendar months. If your payday changes (e.g. a new job), use **Payday changing?** and enter the first payday on the new schedule: earlier cycles keep the old payday.
- Backup and restore are on the Rojak home screen (Money → Settings links there).
- Works offline, has light and dark mode

## Publish with GitHub Pages
1. On GitHub, open this repository → **Settings** → **Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**.
3. Choose the branch (e.g. `main`) and folder **/ (root)**, then tap **Save**.
4. Wait 1–2 minutes and refresh. Your link appears at the top: `https://<your-username>.github.io/<repository-name>/`

## Install on your phone
- **iPhone (Safari):** open the link → Share button → **Add to Home Screen**.
- **Android (Chrome):** open the link → ⋮ menu → **Install app** / **Add to Home screen**.

## Important: back up regularly
Your data is stored only in this browser on this phone. If you delete the app, clear browser data,
or lose your phone, the data is gone. Use **Export backup** on the Rojak home screen and save the file somewhere safe.
On iPhone, the home-screen app and Safari keep separate data — use the home-screen app consistently.

## Files
- `index.html` – the Rojak home screen
- `core/home.js`, `core/home.css` – home screen
- `core/store.js` – the shared data store (IndexedDB), entry dates, backup export / restore / undo / delete for the whole app
- `core/avatar.js` – her drawing, its monthly hair colours and her waving hand
- `core/cat.js` – the cat and its monthly breeds
- `money/` – the money tracker: `index.html`, `style.css`, `app.js` (accounts, transactions, categories, reconciliation, settings), `plan.js` (recurring payments, savings projects, trips and the forecast)
- `money/ocr/` – Tesseract.js (Apache 2.0, licences included) for reading balances from screenshots; loaded only when you pick a screenshot
- `manifest.json`, `sw.js`, `rojak-icon*`, `rojak-apple-touch-icon.png` – make it installable and work offline (`icon-v2.svg`, `apple-touch-icon-v2.png` are the money tracker's own tab icon)

When you change any file, bump `VERSION` in `sw.js` and the matching `?v=` numbers in `index.html` and `money/index.html` (keep them all the same) so phones pick up the update with all files matching.
