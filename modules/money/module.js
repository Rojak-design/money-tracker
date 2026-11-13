/* Rojak · Money module — connects the money tracker (app.js, plan.js) to the Rojak home screen and shared store.
   Nothing here changes how the money tracker itself works. */
'use strict';

// Spending in a period, worked out the same way as the pie chart in History
// (expenses minus money back; transfers and card payments don't count).
function moneySpentBetween(from, to) {
  let total = 0;
  for (const t of state.transactions) {
    if (t.transferId || t.category === 'Transfer') continue;
    if (t.type !== 'expense' && !t.refund) continue;
    if (t.date < from || t.date > to) continue;
    total += t.refund ? -t.amount : t.amount;
  }
  return total;
}
function moneyIncomeBetween(from, to) {
  return state.transactions
    .filter((t) => t.type === 'income' && !t.refund && !t.transferId && t.category !== 'Transfer' && t.date >= from && t.date <= to)
    .reduce((s, t) => s + t.amount, 0);
}

// Opens the transaction form from the home screen (same checks as the + button).
function moneyAdd(type) {
  if (!state.accounts.length) { toast('Create an account first'); show('accounts'); accountSheet(); return; }
  txSheet(null, { type });
}

Rojak.registerModule({
  id: 'money',
  name: 'Money',
  icon: '💰',
  view: 'accounts',
  collections: ['accounts', 'transactions', 'reconciliations', 'recurring', 'projects', 'trips'],
  data: () => state,
  async reload(data) {
    state = Object.assign(emptyState(), data || {});
    migrate();
    await save();
    txFilter = 'all'; txCatFilter = 'all'; piePeriodStart = null;
  },
  describe: (s) => `${(s.accounts || []).length} account(s), ${(s.transactions || []).length} transaction(s)`,

  // The date each kind of entry belongs to, so it can be compared with other modules.
  entry(col, r) {
    if (col === 'transactions') {
      return { date: r.date, amount: r.type === 'income' ? r.amount : -r.amount,
        label: [r.transferId ? 'Transfer' : r.refund ? `Money back · ${r.category || ''}` : r.category, r.note].filter(Boolean).join(' · ') };
    }
    if (col === 'reconciliations') return { date: r.date, amount: r.bank, label: `Checked ${accountName(r.accountId)}` };
    if (col === 'accounts') return { date: r.startDate || (r.savedAt || '').slice(0, 10), label: `Account · ${r.name}` };
    if (col === 'recurring') return { date: r.start, amount: r.amount, label: `Recurring · ${r.name}` };
    if (col === 'trips') return { date: r.start, amount: r.budget || undefined, label: `Trip · ${tripTitle(r)}` };
    if (col === 'projects') return { date: (r.savedAt || '').slice(0, 10), label: `Project · ${r.name}` };
    return {};
  },

  summary() {
    if (!state.accounts.length) return { empty: 'No accounts yet. Add a bank account or card to start tracking.' };
    const t = today();
    const p = periodContaining(t);
    const word = periodWord();
    const net = state.accounts.reduce((s, a) => s + balance(a.id), 0);
    const cardOwed = cardAccounts().reduce((s, a) => s + Math.max(0, owed(a.id)), 0);
    let dueCount = 0, dueTotal = 0;
    for (const r of state.recurring) {
      if (r.type === 'income' || r.type === 'transfer') continue;
      for (const o of occurrencesIdx(r, t, addDaysISO(t, 30))) { dueCount++; dueTotal += nthAmount(r, o.i); }
    }
    const lastCheck = [...state.reconciliations].sort((x, y) => y.date.localeCompare(x.date))[0];
    const cards = [
      { label: cardAccounts().length ? 'Net total' : 'Total balance', value: money(net), neg: net < 0,
        sub: cardOwed ? `${money(cardOwed)} owed on cards` : `${state.accounts.length} account(s)`, view: 'accounts' },
      { label: `Spent this ${word}`, value: money(moneySpentBetween(p.start, p.end)), sub: p.label, view: 'tx' },
      { label: `Income this ${word}`, value: money(moneyIncomeBetween(p.start, p.end)), pos: true, sub: p.label, view: 'tx' },
      { label: 'Due in 30 days', value: money(dueTotal), sub: dueCount ? `${dueCount} recurring payment(s)` : 'Nothing recurring due', view: 'plan', plan: 'recurring' },
      { label: 'Last reconciled', value: lastCheck ? shortDate(lastCheck.date) : '—',
        sub: lastCheck ? accountName(lastCheck.accountId) : 'Not checked yet', view: 'recon', wide: true }
    ];
    return { cards };
  },

  shortcuts: () => [
    { icon: '➖', label: 'Expense', run: () => moneyAdd('expense') },
    { icon: '➕', label: 'Income', run: () => moneyAdd('income') },
    { icon: '⇄', label: 'Transfer', run: () => transferSheet() },
    { icon: '✅', label: 'Reconcile', run: () => show('recon') },
    { icon: '📋', label: 'History', run: () => show('tx') },
    { icon: '📈', label: 'Forecast', run: () => { planTab = 'forecast'; show('plan'); } }
  ]
});
