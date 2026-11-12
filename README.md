# Money Tracker

A simple money tracker that runs in your phone's browser and can be installed on your home screen.
Plain HTML, CSS and JavaScript — no build step. **All data stays on your phone.**

## Features
- Multiple accounts (e.g. Savings, Spending) with a starting balance
- **Transfers** between your own accounts (e.g. salary to a savings account): **⇄ Transfer** on the Accounts screen. A transfer is two linked entries (out of one account, into the other), never counted as spending or income; tap either one in History to edit or delete it. Paying a card bill is a transfer to the card. Regular transfers (e.g. part of your salary into savings every payday) can be set up under Plan → Recurring → **Transfer**; they're listed with what's due and can be logged in one tap.
- Credit cards: log purchases on a card, see what you owe, what you spent this month and last, the next due date and available credit. **Pay card bill** moves money from a bank account to the card (not counted as spending). Reconcile a card by typing the amount owed shown by your bank. Set the card's statement closing day and due day so bills are worked out per statement cycle.
- Log expenses and income: amount, category, date, note (tap an entry to edit or delete it). Entries dated in the future (e.g. PayLater instalments logged ahead) are **planned**: they're tagged in History, don't affect today's balances, and are added to the forecast in the period (and card bill) they fall in.
- **Money back**: log refunds, or a friend paying you back for something you paid for, against the spending category it was for (e.g. Food). It goes into the account like income but is taken off that category, so category totals, the pie chart and the forecast show what you spent yourself.
- Categories for every transaction, with a category filter in History. History also has a pie chart of spending by category for this month (or pay cycle), with ‹ › to look at earlier ones; tap a category to see its transactions. Add, rename or remove categories under **Backup → Manage categories**.
- Daily reconciliation: attach a screenshot of your bank balance, type in the balance shown, and see the difference from the app's balance. Optionally add an adjustment to make them match, and choose which category the adjustment belongs to.
- **Plan** tab:
  - **Recurring** – instalments, loan repayments, subscriptions, rent, salary… (amount, how often, when it ends). Shows what's due in the next 30 days and how many payments are left. Log a payment from it, or link a transaction to it when adding one.
  - **Loans** – a recurring payment can end "when a loan is paid off": enter what's still owed today, the repayment and the interest (already included in what's owed, or charged on what's left at a yearly rate). The app works out the payoff date, payments left, total to pay and interest, and lists loans with what's owed on the Accounts screen.
  - **Forecast** – the next 12 months of spending: recurring payments plus day-to-day spending (food, transport…) projected from your history, using the trend or the average of the last 3, 6 or 12 months. Tap a month for the breakdown. Switch to **Savings** to see how much you can save each month or pay cycle (expected income − spending), the total over 12 months, how that fits your savings projects, and where your bank balance is heading. If you use credit cards, each month or pay cycle also shows the card bills due in it (worked out from each card's statement cycle) and the cash leaving your bank accounts.
  - **Projects** – save for a house, wedding, etc.: list the expected costs, what's saved (typed in or an account's balance) and how much you save each month, and see how many months it will take and whether you'll make a target date. Each cost can have the month it's needed and be paid in monthly instalments (e.g. a sofa in 12 payments from July); the project then shows a payment timeline, the least you need to save each month to pay everything on time, and whether your plan falls short.
- Pay cycles: set your payday under **Backup → Settings** (optionally moved to the Friday before when it falls on a weekend). The forecast, its chart and the category totals in History then use pay cycles (payday to the day before the next payday) instead of calendar months. If your payday changes (e.g. a new job), use **Payday changing?** and enter the first payday on the new schedule: earlier cycles keep the old payday.
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

When you change any file, bump `VERSION` in `sw.js` and the matching `?v=` numbers in `index.html` (keep them all the same) so phones pick up the update with all files matching.
