let expandedDtId = null;
let expandedDtScheduleIds = new Set();
let dtFilter = localStorage.getItem('dtStatusFilter') || 'all';

function getCCLimit(debt) {
    const acc = (data.accounts || []).find(a => a.id === debt.linkedAccountId);
    return parseFloat(acc?.creditLimit ?? debt.creditLimit) || 0;
}

function getCCNextDueDate(debt) {
    if (!debt.firstPaymentDate) return null;
    // Nothing owed = no real due date to project, same as Payoff Date below — showing a
    // future cycle date here would wrongly imply money is scheduled to be due.
    if (getDebtBalance(debt) <= 0.005) return null;
    const day = new Date(debt.firstPaymentDate + 'T00:00:00').getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fmtISO = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    };
    const paidDates = new Set(
        (data.bills || [])
            .filter(b => b.debtId === debt.id && b.debtGenerated && b.paid)
            .map(b => b.dueDate)
    );

    let d = new Date(today.getFullYear(), today.getMonth(), day);
    if (d < today) d = new Date(d.getFullYear(), d.getMonth() + 1, day);
    // Paid early, before the actual due date? Skip past any cycle already settled.
    while (paidDates.has(fmtISO(d))) {
        d = new Date(d.getFullYear(), d.getMonth() + 1, day);
    }
    return d;
}

function getCCPayoffDate(debt) {
    const balance = getDebtBalance(debt);
    const payment = getDebtMonthlyPayment(debt);
    if (!balance || !payment || !debt.firstPaymentDate) return null;
    const apr = parseFloat(debt.apr) || 0;
    const r = apr / 100 / 12;
    let months;
    if (!r) {
        months = Math.ceil(balance / payment);
    } else {
        const ratio = (balance * r) / payment;
        if (ratio >= 1) return null;
        months = Math.ceil(-Math.log(1 - ratio) / Math.log(1 + r));
    }
    if (!isFinite(months) || months <= 0) return null;
    const start = new Date(debt.firstPaymentDate + 'T00:00:00');
    start.setMonth(start.getMonth() + months - 1);
    return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function getManualDebtPayments(debt) {
    // Manual (non-generated) paid Debt Payments transactions for this debt.
    // Credit cards excluded — their payments flow through the linked account balance.
    if (debt.type === 'credit_card') return [];
    return (data.bills || []).filter(b =>
        b.paid && !b.debtGenerated && b.category === "Debt Payments" &&
        (b.debtId === debt.id || (!b.debtId && b.name === debt.name))
    );
}

function getAllManualDebtPayments(debt) {
    // Same as getManualDebtPayments but WITHOUT excluding credit cards — used by the schedule
    // to recognize/display a manual CC payment. Never used for CC balance math (that still
    // comes from the linked account directly), only for marking a row as paid.
    return (data.bills || []).filter(b =>
        b.paid && !b.debtGenerated && b.category === "Debt Payments" &&
        (b.debtId === debt.id || (!b.debtId && b.name === debt.name))
    );
}

function getManualDebtPaidNet(debt) {
    // Manual payments count 100% toward principal; refunds add back.
    return getManualDebtPayments(debt).reduce((s, b) => {
        const amt = parseFloat(b.actualAmount ?? b.amount) || 0;
        return b.type === 'refund' ? s - amt : s + amt;
    }, 0);
}

function getDebtBalance(debt) {
    if (debt.type === 'credit_card' && debt.linkedAccountId) {
        const bal = calcAccountBalance(debt.linkedAccountId, '', '').currentBalance;
        return bal < 0 ? Math.abs(bal) : 0;
    }
    if (debt.type !== 'loan' && debt.type !== 'other') return 0;

    const orig = parseFloat(debt.beginningBalance) || 0;
    const hasGrid = !!debt.firstPaymentDate && (debt.type === 'loan' || debt.repayType === 'monthly'
        || (debt.repayType === 'due_date' && debt.dueDatePayMode === 'installments'));

    if (!hasGrid) {
        // No fixed monthly grid (e.g. pay-by-due-date): payments reduce balance directly
        const paidPrincipal = (data.bills || [])
            .filter(b => b.debtId === debt.id && b.debtGenerated && b.paid)
            .reduce((s, b) => s + Math.max(0, parseFloat(getBillDebtPrincipal(b)) || 0), 0);
        return Math.max(orig - paidPrincipal - getManualDebtPaidNet(debt), 0);
    }

    // Monthly grid: pool all real payments per window, interest is covered first
    const r = (parseFloat(debt.apr) || 0) / 100 / 12;
    const fmtISO = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const paidByDate = {};
    (data.bills || []).forEach(b => {
        if (b.debtId === debt.id && b.debtGenerated && b.paid) paidByDate[b.dueDate] = b;
    });
    const manualPays = getManualDebtPayments(debt).map(b => ({
        date: new Date((b.actualDate || b.dueDate) + 'T00:00:00'),
        amt: (b.type === 'refund' ? -1 : 1) * (parseFloat(b.actualAmount ?? b.amount) || 0)
    }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let maxDate = today;
    manualPays.forEach(mp => { if (mp.date > maxDate) maxDate = mp.date; });
    Object.keys(paidByDate).forEach(iso => {
        const d = new Date(iso + 'T00:00:00');
        if (d > maxDate) maxDate = d;
    });

    let bal = orig;
    let cursor = new Date(debt.firstPaymentDate + 'T00:00:00');
    let prev = new Date(0);

    for (let g = 0; g < 600 && bal > 0.005 && prev < maxDate; g++) {
        const paidBill = paidByDate[fmtISO(cursor)];
        let pool = 0;
        let interest = null;
        if (paidBill) {
            pool += paidBill.actualAmount != null
                ? (parseFloat(paidBill.actualAmount) || 0)
                : (parseFloat(paidBill.amount) || 0);
            if (paidBill.debtInterest != null) interest = parseFloat(getBillDebtInterest(paidBill)) || 0;
        }
        for (const mp of manualPays) {
            if (mp.date > prev && mp.date <= cursor) pool += mp.amt;
        }
        if (pool > 0) {
            if (interest == null) interest = bal * r;
            bal -= Math.max(pool - interest, 0);
        } else if (pool < 0) {
            bal -= pool; // net refund adds back
        }
        prev = cursor;
        const next = new Date(cursor);
        next.setMonth(next.getMonth() + 1);
        cursor = next;
    }

    return Math.max(bal, 0);
}

function getDebtMonthlyPayment(debt) {
    const apr = parseFloat(debt.apr) || 0;
    if (debt.type === 'credit_card') {
        const min = parseFloat(debt.minPayment) || 0;
        const planned = parseFloat(debt.plannedPayment) || 0;
        return planned > min ? planned : min;
    }
    if (debt.type === 'loan') {
        const P = parseFloat(debt.beginningBalance) || 0;
        const n = parseInt(debt.termMonths) || 0;
        if (!P || !n) return 0;
        if (!apr) return P / n;
        const r = apr / 100 / 12;
        if (debt.repaymentType === 'fixed_principal') return (P / n) + P * r;
        return P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    }
    if (debt.type === 'other') {
        if (debt.repayType === 'monthly') return parseFloat(debt.monthlyPayment) || 0;
        if (debt.repayType === 'due_date' && debt.dueDate) {
            if (debt.dueDatePayMode === 'lump_sum') return getDebtBalance(debt);
            if (debt.dueDatePayMode === 'installments' && debt.firstPaymentDate) {
                // Fixed monthly payment, computed once from the original balance and the
                // fixed term between the first payment date and the due date — stable,
                // like a loan's payment, not recalculated as time passes or balance changes.
                const P = parseFloat(debt.beginningBalance) || 0;
                if (!P) return 0;
                const start = new Date(debt.firstPaymentDate + 'T00:00:00');
                const due = new Date(debt.dueDate + 'T00:00:00');
                const months = (due.getFullYear() - start.getFullYear()) * 12 + (due.getMonth() - start.getMonth()) + 1;
                if (months <= 0) return P;
                const r = apr / 100 / 12;
                if (!r) return P / months;
                return P * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
            }
            // Legacy debt saved before the repayment-mode choice existed — no stored first
            // payment date to anchor on, so estimate from today instead.
            const P = getDebtBalance(debt);
            if (!P) return 0;
            const due = new Date(debt.dueDate + 'T00:00:00');
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const months = (due.getFullYear() - today.getFullYear()) * 12 + (due.getMonth() - today.getMonth());
            if (months <= 0) return P;
            const r = apr / 100 / 12;
            if (!r) return P / months;
            return P * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
        }
    }
    return 0;
}

function getOtherPayoffDate(debt) {
    if (debt.type !== 'other' || debt.repayType !== 'monthly') return null;
    const P = parseFloat(debt.beginningBalance) || 0;
    const monthly = parseFloat(debt.monthlyPayment) || 0;
    const apr = parseFloat(debt.apr) || 0;
    if (!P || !monthly || !debt.firstPaymentDate) return null;
    const r = apr / 100 / 12;
    let months;
    if (!r) {
        months = Math.ceil(P / monthly);
    } else {
        months = Math.ceil(-Math.log(1 - (P * r) / monthly) / Math.log(1 + r));
    }
    if (!isFinite(months) || months <= 0) return null;
    const start = new Date(debt.firstPaymentDate + 'T00:00:00');
    start.setMonth(start.getMonth() + months - 1);
    return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function getDebtMonthlyInterest(debt) {
    const apr = parseFloat(debt.apr) || 0;
    if (!apr) return 0;
    return getDebtBalance(debt) * apr / 100 / 12;
}

function generateDebtTransactions(debt) {
    const fmtDate = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const fromAccount = debt.txFromAccount || null;
    const toAccount = debt.type === "credit_card" ? (debt.linkedAccountId || null) : null;
    const priority = debt.txPriority ?? 1;
    const seriesId = debt.id;

    // Remove existing planned (not paid) generated transactions for this debt
    data.bills = data.bills.filter(b => !(b.debtId === debt.id && b.debtGenerated && !b.paid));

    // Sync name on paid generated transactions
    data.bills = data.bills.map(b =>
        (b.debtId === debt.id && b.debtGenerated && b.paid) ? { ...b, name: debt.name } : b
    );

    // Generate planned transactions from schedule (including past/overdue rows for retro budgets)
    const schedule = generatePayoffSchedule(debt);

    // Never duplicate over a paid transaction with the same due date (e.g. credit cards)
    const paidDueDates = new Set(
        data.bills.filter(b => b.debtId === debt.id && b.debtGenerated && b.paid).map(b => b.dueDate)
    );

    const newBills = schedule
        .filter(row => !row.paid && !paidDueDates.has(fmtDate(row.date)))
        .map(row => ({
            id: crypto.randomUUID(),
            seriesId,
            name: debt.name,
            category: "Debt Payments",
            type: "payment",
            amount: parseFloat(row.payment.toFixed(2)),
            actualAmount: null,
            dueDate: fmtDate(row.date),
            actualDate: null,
            priority,
            frequency: "one-time",
            interval: 1,
            endDate: null,
            notes: "",
            paid: false,
            fromAccount,
            toAccount,
            debtId: debt.id,
            debtGenerated: true,
            debtPrincipal: parseFloat(Math.max(row.payment - row.interest, 0).toFixed(2)),
            debtInterest: parseFloat(row.interest.toFixed(2)),
            actualDebtPrincipal: null,
            actualDebtInterest: null
        }));

    data.bills.push(...newBills);
}

function getDebtCurrentMonthInfo(debt) {
    // Anchored to the actual calendar month — not "next unpaid row", which can jump back
    // to an overdue past month for one debt while the rest are current, mixing different
    // months into one confusing total. This always reflects THIS month specifically.
    const schedule = generatePayoffSchedule(debt);
    const today = new Date();
    const curRow = schedule.find(row => row.date.getFullYear() === today.getFullYear() && row.date.getMonth() === today.getMonth());
    if (!curRow) return { required: 0, paid: 0, interest: 0 };
    return { required: curRow.payment, paid: curRow.actualPaid, interest: curRow.interest };
}

function renderDebtSummaryCards() {
    const debts = data.debts || [];
    const active   = debts.filter(d => !d.paidOff);
    const totalDebt = active.reduce((s, d) => s + getDebtBalance(d), 0);
    const monthInfos = active.map(d => getDebtCurrentMonthInfo(d));
    const monthRequired = monthInfos.reduce((s, i) => s + i.required, 0);
    const monthPaid = monthInfos.reduce((s, i) => s + i.paid, 0);
    const monthInterest = monthInfos.reduce((s, i) => s + i.interest, 0);
    // Live "currently at $0" count, not the sticky paidOff flag — a credit card sitting at
    // $0 right now is a real win worth counting, even though it can go back up tomorrow.
    const zeroNowCount = debts.filter(d => getDebtBalance(d) <= 0.005).length;

    const el = id => document.getElementById(id);
    if (el('dtSumTotal'))    el('dtSumTotal').textContent    = formatMoney(totalDebt);
    if (el('dtSumMonthly'))  el('dtSumMonthly').textContent  = `${formatMoney(monthPaid)} of ${formatMoney(monthRequired)}`;
    if (el('dtSumInterest')) el('dtSumInterest').textContent = formatMoney(monthInterest);
    if (el('dtSumCount'))    el('dtSumCount').textContent    = `${zeroNowCount} / ${debts.length}`;
}

function generatePayoffSchedule(debt) {
    const rows = [];
    const apr = parseFloat(debt.apr) || 0;
    const r = apr / 100 / 12;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payment = getDebtMonthlyPayment(debt);
    if (!payment || payment <= 0) return rows;

    const fmtISO = d => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    // Replay mode: fixed monthly grid from first payment date (loan / other-monthly / other-due_date-installments).
    // Rebuilds history from beginningBalance applying real paid amounts, then projects forward.
    const isReplay = (debt.type === 'loan' && debt.firstPaymentDate)
        || (debt.type === 'other' && debt.repayType === 'monthly' && debt.firstPaymentDate)
        || (debt.type === 'other' && debt.repayType === 'due_date' && debt.dueDatePayMode === 'installments' && debt.firstPaymentDate);

    const startBalance = isReplay ? (parseFloat(debt.beginningBalance) || 0) : getDebtBalance(debt);
    if (startBalance <= 0.005) return rows;

    // First payment date
    let firstDate = null;
    if (isReplay) {
        firstDate = new Date(debt.firstPaymentDate + 'T00:00:00');
    } else if (debt.type === 'other' && debt.repayType === 'due_date' && debt.dueDate) {
        if (debt.dueDatePayMode === 'lump_sum') {
            // One-time payment: a single row, due exactly on the due date.
            firstDate = new Date(debt.dueDate + 'T00:00:00');
        } else {
            // Legacy debt saved before the repayment-mode choice existed (no stored first
            // payment date) — anchor backward from the due date using today's date.
            const dueD = new Date(debt.dueDate + 'T00:00:00');
            const monthsToDue = (dueD.getFullYear() - today.getFullYear()) * 12 + (dueD.getMonth() - today.getMonth());
            const n = monthsToDue > 0 ? monthsToDue : 1;
            firstDate = new Date(dueD.getFullYear(), dueD.getMonth() - (n - 1), dueD.getDate());
        }
    } else if (debt.type === 'credit_card') {
        firstDate = getCCNextDueDate(debt);
    }
    if (!firstDate) {
        const s = new Date();
        s.setDate(1);
        s.setMonth(s.getMonth() + 1);
        firstDate = s;
    }

    // Generated transactions indexed by due date — recognized for every debt type (isReplay only
    // controls whether we reconstruct the starting balance/date from an origin, not whether we
    // look up real paid/pending transactions).
    const paidByDate = {};
    const pendingByDate = {};
    (data.bills || []).forEach(b => {
        if (b.debtId === debt.id && b.debtGenerated) {
            if (b.paid) paidByDate[b.dueDate] = b;
            else pendingByDate[b.dueDate] = b;
        }
    });

    // Manual paid payments, applied in the row window they fall in — recognized for every
    // debt type (including credit cards) so the schedule reflects real payments regardless
    // of source. For non-replay debts (CC/other-due-date), see the balance-math note below:
    // startBalance already reflects these via the real account/current balance.
    const manualPays = getAllManualDebtPayments(debt).map(b => ({
        date: new Date((b.actualDate || b.dueDate) + 'T00:00:00'),
        amt: (b.type === 'refund' ? -1 : 1) * (parseFloat(b.actualAmount ?? b.amount) || 0)
    }));

    const term = parseInt(debt.termMonths) || 0;
    const isFixedPrincipal = debt.type === 'loan' && debt.repaymentType === 'fixed_principal';
    const plannedPrincipal = (isFixedPrincipal && term > 0) ? startBalance / term : 0;

    let currentDate = new Date(firstDate);
    let prevDate = new Date(0);
    let balanceExact = startBalance;
    let balance = startBalance;
    const MAX = (debt.type === 'loan' && term > 0) ? term : 600;
    let stuckMonths = 0; // consecutive projected (no real money) rows where the balance grew

    for (let i = 1; i <= MAX && balance > 0.005; i++) {
        const paidBill = paidByDate[fmtISO(currentDate)];
        const pendingBill = pendingByDate[fmtISO(currentDate)];

        // Raw manual money in this row's window: after previous due date, up to and including this one
        let rawManual = 0;
        for (const mp of manualPays) {
            if (mp.date > prevDate && mp.date <= currentDate) rawManual += mp.amt;
        }
        rawManual = parseFloat(rawManual.toFixed(2));

        // Baseline scheduled installment for this row — used for display and as the
        // regular-vs-extra threshold, regardless of whether/how it was paid.
        let scheduledPay;
        if (isFixedPrincipal) {
            const interestGuess = parseFloat((balanceExact * r).toFixed(2));
            const p = (balanceExact - plannedPrincipal <= 0.005) ? balanceExact : plannedPrincipal;
            scheduledPay = parseFloat((p + interestGuess).toFixed(2));
        } else {
            scheduledPay = payment;
        }
        // Payment always shows the base installment — even if a higher amount is pre-filled
        // (e.g. from a Payoff Plan budget allocation) as a preview for when it's marked paid.
        if (pendingBill) scheduledPay = parseFloat(pendingBill.amount) || scheduledPay;
        if (paidBill) scheduledPay = parseFloat(paidBill.amount) || scheduledPay;

        // Real money that actually came in this window, from any source
        const genPaidAmt = paidBill
            ? (paidBill.actualAmount != null ? parseFloat(paidBill.actualAmount) : parseFloat(paidBill.amount)) || 0
            : 0;
        const realMoney = parseFloat((genPaidAmt + rawManual).toFixed(2));

        // A row is "paid" once real money (generated + manual, however it happened) covers
        // the installment — or if the user explicitly marked the generated transaction paid.
        const isPaidRow = !!paidBill || (!pendingBill && realMoney >= scheduledPay - 0.01 && realMoney > 0.005);

        const interest = (paidBill && paidBill.debtInterest != null)
            ? (parseFloat(getBillDebtInterest(paidBill)) || 0)
            : parseFloat((balanceExact * r).toFixed(2));

        // The Balance column is a running projection (like a bank statement's amortization
        // table): it always assumes the scheduled payment happens, so it keeps declining even
        // on overdue rows. "Overdue" is a separate flag for whether real money actually came
        // in. Real money (when present) replaces the projection — never adds on top of it.
        const totalPay = realMoney > 0.005 ? realMoney : scheduledPay;

        // If the payment doesn't cover the interest, principal goes negative — the balance
        // actually grows (negative amortization), same as a real card/loan would behave.
        let principal;
        if (totalPay > 0) {
            principal = parseFloat((totalPay - interest).toFixed(2));
        } else {
            principal = totalPay; // net refund — adds back to balance
        }

        // Close the loan on the final row: rounding leftovers merge into the last installment
        if (!isReplay && isPaidRow) {
            // Non-replay (CC / other-due-date): startBalance already reflects this real
            // payment via the account/current balance — don't subtract it again here.
            balanceExact = parseFloat(balanceExact.toFixed(2));
        } else if (principal >= balanceExact - 0.005 || (i === MAX && !isPaidRow)) {
            principal = parseFloat(balanceExact.toFixed(2));
            if (!isPaidRow) {
                scheduledPay = parseFloat(Math.max(principal + interest, 0).toFixed(2));
            }
            balanceExact = 0;
        } else {
            balanceExact -= principal;
        }
        balance = parseFloat(balanceExact.toFixed(2));

        // Actual Paid is always the full real money for the window, from any/all sources
        // combined (generated transaction + manual, however many there are — they add up).
        // Extra Payments is just an informational breakdown of how much of that total went
        // beyond the scheduled amount — it's already included in Actual Paid, not additive.
        const actualPaid = realMoney;
        const extra = Math.max(realMoney - scheduledPay, 0);

        rows.push({ nr: i, date: new Date(currentDate), payment: scheduledPay, actualPaid, extra, principal, interest, balance, paid: isPaidRow });

        // If the payment never covers interest (pure projection, no real money), the balance
        // only grows — stop after a year of that instead of projecting decades of debt growth.
        if (!paidBill && !pendingBill && realMoney <= 0.005 && principal < 0) {
            stuckMonths++;
            if (stuckMonths >= 12) break;
        } else {
            stuckMonths = 0;
        }

        prevDate = currentDate;
        const next = new Date(currentDate);
        next.setMonth(next.getMonth() + 1);
        currentDate = next;
    }

    return rows;
}

function renderPayoffSchedule(debt) {
    const schedule = generatePayoffSchedule(debt);
    if (!schedule.length) {
        return `<div class="dt-schedule-empty">No payment data available to generate schedule.</div>`;
    }

    const showAll = expandedDtScheduleIds.has(debt.id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentIdx = schedule.findIndex(row => !row.paid);

    const fmtD = d => {
        const mo = d.toLocaleString('en-US', { month: 'short' });
        return `${mo} ${d.getDate()}, ${d.getFullYear()}`;
    };

    const rowsHtml = schedule.map((row, i) => {
        let cls = '';
        let extraAttr = '';
        if (row.paid) {
            cls = ' class="dt-sch-row--past"';
        } else if (row.date < today) {
            cls = ' class="dt-sch-row--overdue"';
        }
        if (!row.paid && i === currentIdx) {
            extraAttr = ` id="dt-sch-current-${debt.id}"`;
        }
        let statusHtml;
        if (row.paid) {
            statusHtml = `<span class="dt-sch-status dt-sch-status--paid">✓ Paid</span>`;
        } else if (row.date < today) {
            statusHtml = `<span class="dt-sch-status dt-sch-status--overdue">Overdue</span>`;
        } else {
            const days = daysBetweenUTC(today, row.date);
            statusHtml = `<span class="dt-sch-status dt-sch-status--due">${days} day${days !== 1 ? 's' : ''} left</span>`;
        }
        return `<tr${cls}${extraAttr}>
            <td class="dt-sch-nr">${row.nr}</td>
            <td>${fmtD(row.date)}</td>
            <td>${row.payment ? formatMoney(row.payment) : '—'}</td>
            <td>${row.actualPaid ? formatMoney(row.actualPaid) : '—'}</td>
            <td>${row.extra ? formatMoney(row.extra) : '—'}</td>
            <td>${row.principal ? formatMoney(row.principal) : '—'}</td>
            <td class="dt-sch-interest">${row.interest ? formatMoney(row.interest) : '—'}</td>
            <td class="dt-sch-bal">${formatMoney(row.balance)}</td>
            <td>${statusHtml}</td>
        </tr>`;
    }).join('');

    const payoffDate = fmtD(schedule[schedule.length - 1].date);
    const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
    const leftToPay = schedule.reduce((s, r) => s + (r.paid ? 0 : r.payment), 0);

    const toggleBtn = `
        <button class="dt-schedule-toggle" onclick="event.stopPropagation();toggleDtScheduleAll('${debt.id}')">
            ${showAll ? '▲ Show less' : `▼ Show all ${schedule.length} payments`}
        </button>`;

    return `
        <div class="dt-schedule">
            <div class="dt-schedule-meta">
                <span class="help-icon" data-help-title="Payment Schedule" data-help="One row per month, from the first payment until the debt is paid off.&lt;br&gt;&lt;br&gt;&lt;strong&gt;Payment&lt;/strong&gt; — the planned monthly installment.&lt;br&gt;&lt;strong&gt;Actual Paid&lt;/strong&gt; — the sum you actually paid for that installment.&lt;br&gt;&lt;strong&gt;Extra Payments&lt;/strong&gt; — additional payments made in that month.&lt;br&gt;&lt;strong&gt;Interest / Principal&lt;/strong&gt; — each month your money covers the interest first; the rest reduces the balance.&lt;br&gt;&lt;strong&gt;Status&lt;/strong&gt; — paid, overdue, or days left until the due date.&lt;br&gt;&lt;br&gt;Grey rows are already paid. &quot;—&quot; means no amount in that column for that month (e.g. no extra payments).&lt;br&gt;&lt;br&gt;The schedule recalculates after every payment — extra payments shorten it.">ℹ️</span>
                <span><strong>${schedule.length}</strong> payments</span>
                <span>Total interest: <strong>${formatMoney(totalInterest)}</strong></span>
                <span>Left to pay incl. interest: <strong>${formatMoney(leftToPay)}</strong></span>
            </div>
            <div class="dt-schedule-table-wrap${showAll ? ' dt-schedule-table-wrap--expanded' : ''}" id="dt-sch-scroll-${debt.id}">
                <table class="dt-schedule-table">
                    <thead>
                        <tr>
                            <th>#</th><th>Date</th><th>Payment</th><th>Actual Paid</th><th>Extra Payments</th><th>Principal</th><th>Interest</th><th>Balance</th><th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            ${toggleBtn}
        </div>`;
}

function toggleDtScheduleAll(id) {
    if (expandedDtScheduleIds.has(id)) {
        expandedDtScheduleIds.delete(id);
    } else {
        expandedDtScheduleIds.add(id);
    }
    renderDebtPage();
    if (expandedDtScheduleIds.has(id)) {
        requestAnimationFrame(() => scrollDtScheduleToCurrent(id));
    }
}

function scrollDtScheduleToCurrent(debtId) {
    const wrap = document.getElementById('dt-sch-scroll-' + debtId);
    const row  = document.getElementById('dt-sch-current-' + debtId);
    if (!wrap || !row) return;
    wrap.scrollTop = row.offsetTop - wrap.clientHeight / 2 + row.offsetHeight / 2;
}

function renderDebtCard(debt) {
    const isExpanded = expandedDtId === debt.id;
    const isPaidOff  = !!debt.paidOff;
    const isArchived = !!debt.archived;
    const balance    = getDebtBalance(debt);
    const apr        = parseFloat(debt.apr) || 0;
    // Credit cards never get the sticky paidOff flag (revolving debt can always come back),
    // but the card looks mint live, for as long as it's actually at $0 — reverts to normal
    // the instant a new charge appears. Different from loan/other's grey "done" — this isn't
    // permanent, it's just the current moment.
    const isCCSettled = debt.type === 'credit_card' && balance <= 0.005;

    const typeLabel = debt.type === 'credit_card' ? '💳 Credit Card'
                    : debt.type === 'loan'        ? '🏦 Loan'
                    :                               '📄 Other';

    const linkedAcc = debt.linkedAccountId
        ? (data.accounts || []).find(a => a.id === debt.linkedAccountId)
        : null;
    const subLabel = linkedAcc ? `💳 ${escapeHtml(linkedAcc.name)}` : typeLabel;

    // Progress bar
    let pct = 0, pctSuffix = '', barColor = 'var(--pink)', barOfText = '';
    const ccLimit = getCCLimit(debt);
    if (debt.type === 'credit_card' && ccLimit > 0) {
        const limit = ccLimit;
        // Fill direction matches loan/other below: full bar = good (little/no debt), not
        // full = utilization. A paid-off card ($0 balance) should look "done", not empty.
        const utilizationPct = Math.min((balance / limit) * 100, 100);
        pct = Math.max(0, 100 - utilizationPct);
        barColor = isArchived ? 'var(--muted)' : isCCSettled ? 'var(--mint)' : utilizationPct > 75 ? 'var(--red)' : utilizationPct > 40 ? 'var(--orange)' : 'var(--pink)';
        pctSuffix = ' available';
        barOfText = `${formatMoney(balance)} owed of ${formatMoney(limit)} limit`;
    } else if (debt.type === 'loan' || debt.type === 'other') {
        const orig = parseFloat(debt.beginningBalance) || 0;
        const paid = Math.max(orig - balance, 0);
        pct = orig > 0 ? Math.min((paid / orig) * 100, 100) : 0;
        barColor = isArchived ? 'var(--muted)' : isPaidOff ? 'var(--done-text-strong)' : (debt.type === 'loan' ? 'var(--orange)' : 'var(--yellow)');
        pctSuffix = ' paid';
        barOfText = `${formatMoney(paid)} paid of ${formatMoney(orig)}`;
    }

    // Stats
    let statsHtml = '';
    if (debt.type === 'credit_card') {
        const minP      = parseFloat(debt.minPayment) || 0;
        const planned   = parseFloat(debt.plannedPayment) || 0;
        const payLabel  = planned > 0 ? 'Planned Payment' : 'Min Payment';
        const payValue  = planned > 0 ? formatMoney(planned) + '/mo' : (minP > 0 ? formatMoney(minP) + '/mo' : '—');
        const nextDue   = getCCNextDueDate(debt);
        const fmtNextDue = nextDue ? nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
        const payoffDate = getCCPayoffDate(debt) || '—';
        statsHtml = `
            <div class="dt-stat">
                <span class="dt-stat-label">APR</span>
                <span class="dt-stat-value">${debt.apr !== '' && debt.apr != null ? apr.toFixed(2) + '%' : '—'}</span>
            </div>
            <div class="dt-stat">
                <span class="dt-stat-label">${payLabel}</span>
                <span class="dt-stat-value">${payValue}</span>
            </div>
            <div class="dt-stat">
                <span class="dt-stat-label">Next Due Date</span>
                <span class="dt-stat-value">${fmtNextDue}</span>
            </div>
            <div class="dt-stat">
                <span class="dt-stat-label">Payoff Date</span>
                <span class="dt-stat-value">${payoffDate}</span>
            </div>`;
    } else if (debt.type === 'loan') {
        const rateType = debt.rateType === 'variable' ? 'Variable' : 'Fixed';
        const schedule = generatePayoffSchedule(debt);
        const nextRow = schedule.find(row => !row.paid);
        const nextPayment = nextRow ? nextRow.payment : (schedule.length ? schedule[schedule.length - 1].payment : 0);
        const nextPaymentDate = nextRow
            ? nextRow.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—';
        let loanPayoffDate = '—';
        if (schedule.length) {
            loanPayoffDate = schedule[schedule.length - 1].date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } else if (debt.firstPaymentDate && parseInt(debt.termMonths) > 0) {
            const pd = new Date(debt.firstPaymentDate + 'T00:00:00');
            pd.setMonth(pd.getMonth() + parseInt(debt.termMonths) - 1);
            loanPayoffDate = pd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        }
        statsHtml = `
            <div class="dt-stat">
                <span class="dt-stat-label">APR</span>
                <span class="dt-stat-value">${debt.apr !== '' && debt.apr != null ? apr.toFixed(2) + '%' : '—'} <span class="dt-rate-type">(${rateType})</span></span>
            </div>
            <div class="dt-stat">
                <span class="dt-stat-label">Next Payment</span>
                <span class="dt-stat-value">${nextPayment > 0 ? formatMoney(nextPayment) + '/mo' : '—'}</span>
            </div>
            <div class="dt-stat">
                <span class="dt-stat-label">Next Due Date</span>
                <span class="dt-stat-value">${nextPaymentDate}</span>
            </div>
            <div class="dt-stat">
                <span class="dt-stat-label">Payoff Date</span>
                <span class="dt-stat-value">${loanPayoffDate}</span>
            </div>`;
    } else {
        const monthly = getDebtMonthlyPayment(debt);
        const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
        if (debt.repayType === 'monthly') {
            const schedule = generatePayoffSchedule(debt);
            const nextRow = schedule.find(row => !row.paid);
            const nextDate = nextRow
                ? nextRow.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—';
            const estPayoff = schedule.length
                ? schedule[schedule.length - 1].date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : (getOtherPayoffDate(debt) || '—');
            statsHtml = `
                <div class="dt-stat">
                    <span class="dt-stat-label">APR</span>
                    <span class="dt-stat-value">${debt.apr !== '' && debt.apr != null ? apr.toFixed(2) + '%' : '—'}</span>
                </div>
                <div class="dt-stat">
                    <span class="dt-stat-label">Monthly Payment</span>
                    <span class="dt-stat-value">${monthly > 0 ? formatMoney(monthly) + '/mo' : '—'}</span>
                </div>
                <div class="dt-stat">
                    <span class="dt-stat-label">Next Due Date</span>
                    <span class="dt-stat-value">${nextDate}</span>
                </div>
                <div class="dt-stat">
                    <span class="dt-stat-label">Est. Payoff</span>
                    <span class="dt-stat-value">${estPayoff}</span>
                </div>`;
        } else {
            statsHtml = `
                <div class="dt-stat">
                    <span class="dt-stat-label">APR</span>
                    <span class="dt-stat-value">${debt.apr !== '' && debt.apr != null ? apr.toFixed(2) + '%' : '—'}</span>
                </div>
                <div class="dt-stat">
                    <span class="dt-stat-label">Due Date</span>
                    <span class="dt-stat-value">${fmtDate(debt.dueDate)}</span>
                </div>
                <div class="dt-stat">
                    <span class="dt-stat-label">Monthly Needed</span>
                    <span class="dt-stat-value">${monthly > 0 ? formatMoney(monthly) + '/mo' : '—'}</span>
                </div>`;
        }
    }

    const chevronSvg = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 8 10 13 15 8"/></svg>`;
    const editSvg    = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5 L16.5 6.5 L7 16 L3 17 L4 13 Z"/><line x1="11" y1="5.5" x2="14.5" y2="9"/></svg>`;

    const progressSection = (debt.type === 'credit_card' || debt.type === 'loan' || (debt.type === 'other' && balance > 0)) ? `
      <div class="dt-debt-progress">
        <div class="ipb-track">
          <div class="ipb-segments">
            <div class="ipb-segment" style="width:${pct.toFixed(1)}%;background:${barColor};"></div>
          </div>
        </div>
        <div class="dt-bar-labels">
          <span class="dt-bar-pct">${pct.toFixed(0)}%${pctSuffix}</span>
          <span class="dt-bar-of">${barOfText}</span>
        </div>
        <div class="dt-debt-stats">${statsHtml}</div>
      </div>` : `
      <div class="dt-debt-progress">
        <div class="dt-debt-stats">${statsHtml}</div>
      </div>`;

    const notesHtml = debt.notes && debt.type !== 'other'
        ? `<div class="dt-debt-notes">✏️ ${escapeHtml(debt.notes)}</div>`
        : '';

    const monthlyInterest = getDebtMonthlyInterest(debt);
    const currentPayment = getDebtMonthlyPayment(debt);
    const underwaterHtml = (!isPaidOff && !isArchived && balance > 0.005 && monthlyInterest > 0.005 && currentPayment < monthlyInterest - 0.005)
        ? `<div class="dt-debt-warning">⚠️ This payment (${formatMoney(currentPayment)}) doesn't cover the monthly interest (${formatMoney(monthlyInterest)}) — the balance will grow instead of shrinking.</div>`
        : '';

    return `
    <div class="dt-debt-card dt-debt-card--${debt.type === 'credit_card' ? 'cc' : debt.type === 'loan' ? 'loan' : 'other'}${isPaidOff ? ' dt-debt-card--paidoff' : ''}${isCCSettled ? ' dt-debt-card--cc-settled' : ''}${isArchived ? ' dt-debt-card--archived' : ''}" id="dt-card-${debt.id}">
      <div class="dt-debt-header" onclick="toggleDtExpand('${debt.id}')">
        <span class="dt-debt-name">${escapeHtml(debt.name)}</span>
        <div class="dt-debt-balance-wrap">
          <span class="dt-debt-balance">${isPaidOff ? '✓ Paid' : formatMoney(balance)}</span>
          <span class="dt-debt-balance-label">Remaining</span>
        </div>
        <span class="dt-debt-type">${subLabel}${isArchived ? ' <span class="dt-badge dt-badge--archived">Archived</span>' : ''}</span>
        <div class="dt-debt-ctrls">
          <button class="mini-btn edit-btn app-tooltip-trigger dt-debt-edit" onclick="event.stopPropagation();openDebtModal('${debt.id}')">
            ${editSvg}<span class="app-tooltip">Edit</span>
          </button>
          <div class="acc-page-chevron${isExpanded ? ' acc-page-chevron--open' : ''}">
            ${chevronSvg}
          </div>
        </div>
      </div>
      ${progressSection}
      ${underwaterHtml}
      ${notesHtml}
      ${isExpanded ? `<div class="dt-debt-tx">${renderPayoffSchedule(debt)}</div>` : ''}
    </div>`;
}

// ── Payoff Plan (snowball / avalanche / custom) ──────────────

let dtPlanExpanded = localStorage.getItem('dtPlanExpanded') === '1';

function getPlanDebts() {
    // Any debt (finished loan/other or a $0 credit card) stays visible here until the user
    // archives it — consistent with the main debt list. Their schedules naturally stop
    // asking for anything once paid off, so keeping them costs nothing in the simulation.
    return (data.debts || [])
        .filter(d => !d.archived)
        .map(d => ({
            id: d.id,
            name: d.name,
            balance: getDebtBalance(d),
            apr: parseFloat(d.apr) || 0,
            minPay: getDebtMonthlyPayment(d),
            remaining: generatePayoffSchedule(d).filter(row => !row.paid).length
        }));
}

// Tie-break chain: primary criterion first, then the other rate/balance criterion,
// then whichever debt pays off soonest (fewest remaining installments).
function sortPlanDebtsFresh(planDebts, strategy) {
    if (strategy === 'avalanche') {
        return [...planDebts].sort((a, b) => (b.apr - a.apr) || (a.balance - b.balance) || (a.remaining - b.remaining));
    }
    return [...planDebts].sort((a, b) => (a.balance - b.balance) || (b.apr - a.apr) || (a.remaining - b.remaining));
}

function orderPlanDebts(planDebts) {
    const plan = data.debtPlan || {};
    const strategy = plan.strategy || 'snowball';
    if (strategy === 'custom') {
        const order = Array.isArray(plan.customOrder) ? plan.customOrder : [];
        return [...planDebts].sort((a, b) => {
            const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
    }
    // Snowball / avalanche: the order is locked in once (on strategy switch, or when a new
    // debt joins the plan) — everyday balance/APR fluctuations (e.g. a credit card charge)
    // never reshuffle who's currently being targeted, only an actual payoff/removal or a
    // newly added debt does. Any id no longer active (paid off/archived/deleted) is dropped
    // automatically; any debt not yet in the lock (defensive fallback) is appended, sorted
    // fresh among just themselves.
    const lockKey = strategy === 'avalanche' ? 'avalancheOrder' : 'snowballOrder';
    const locked = (Array.isArray(plan[lockKey]) ? plan[lockKey] : []).filter(id => planDebts.some(d => d.id === id));
    const lockedSet = new Set(locked);
    const byId = new Map(planDebts.map(d => [d.id, d]));
    const unlocked = sortPlanDebtsFresh(planDebts.filter(d => !lockedSet.has(d.id)), strategy);
    return locked.map(id => byId.get(id)).concat(unlocked);
}

function insertNewDebtIntoPlanLock(newDebtId) {
    if (!data.debtPlan) return;
    const strategy = data.debtPlan.strategy;
    if (strategy !== 'snowball' && strategy !== 'avalanche') return;
    const lockKey = strategy === 'avalanche' ? 'avalancheOrder' : 'snowballOrder';
    const lockedIds = Array.isArray(data.debtPlan[lockKey]) ? data.debtPlan[lockKey] : [];
    if (!lockedIds.length) return; // nothing locked yet — next render/switch computes fresh anyway

    const planDebts = getPlanDebts();
    const newSummary = planDebts.find(d => d.id === newDebtId);
    if (!newSummary) return;
    const byId = new Map(planDebts.map(d => [d.id, d]));
    const cmp = strategy === 'avalanche'
        ? (a, b) => (b.apr - a.apr) || (a.balance - b.balance) || (a.remaining - b.remaining)
        : (a, b) => (a.balance - b.balance) || (b.apr - a.apr) || (a.remaining - b.remaining);

    const locked = lockedIds.filter(id => id !== newDebtId);
    let insertAt = locked.length;
    for (let i = 0; i < locked.length; i++) {
        const existing = byId.get(locked[i]);
        if (existing && cmp(newSummary, existing) < 0) { insertAt = i; break; }
    }
    locked.splice(insertAt, 0, newDebtId);
    data.debtPlan[lockKey] = locked;
}
window.insertNewDebtIntoPlanLock = insertNewDebtIntoPlanLock;

function dtMonthKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysBetweenUTC(from, to) {
    // Calendar-day difference, immune to DST shifts (which make raw ms/86400000 off by one
    // whenever the range crosses a clock change).
    const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86400000);
}

function getDebtPaidHistoryByMonth(debt) {
    // Real money paid toward this debt, grouped by calendar month (refunds subtract)
    const map = {};
    (data.bills || []).forEach(b => {
        if (!b.paid) return;
        const isOurs = b.debtId === debt.id
            || (!b.debtId && !b.debtGenerated && b.category === "Debt Payments" && b.name === debt.name);
        if (!isOurs) return;
        const d = new Date((b.actualDate || b.dueDate) + 'T00:00:00');
        const k = dtMonthKey(d);
        const amt = (b.type === 'refund' ? -1 : 1) * (parseFloat(b.actualAmount ?? b.amount) || 0);
        map[k] = (map[k] || 0) + amt;
    });
    return map;
}

function getDebtOverdueByMonth(debt) {
    // Unpaid amounts whose due date is in the past, grouped by month
    const map = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (debt.type === 'credit_card') {
        (data.bills || []).forEach(b => {
            if (b.debtId !== debt.id || !b.debtGenerated || b.paid) return;
            const d = new Date(b.dueDate + 'T00:00:00');
            if (d >= today) return;
            const k = dtMonthKey(d);
            map[k] = (map[k] || 0) + (parseFloat(b.amount) || 0);
        });
    } else {
        generatePayoffSchedule(debt).forEach(row => {
            if (row.paid || row.date >= today || !row.payment) return;
            const k = dtMonthKey(row.date);
            map[k] = (map[k] || 0) + row.payment;
        });
    }
    return map;
}

function simulateDtPlanForward(ordered, budgets) {
    // Unified month-by-month timeline — one row per calendar month, from the earliest relevant
    // month to debt-free. Whether a month is "in the past" or "in the future" doesn't matter:
    // what matters is whether it has actually been PAID. Unpaid months (overdue or upcoming)
    // are all part of the same live redistribution (min payments + surplus to target).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const curMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const curKey = dtMonthKey(curMonth);

    const info = {};
    let minKey = curKey;
    ordered.forEach(d => {
        const debt = (data.debts || []).find(x => x.id === d.id);
        const isReplay = (debt.type === 'loan' && debt.firstPaymentDate)
            || (debt.type === 'other' && debt.repayType === 'monthly' && debt.firstPaymentDate)
            || (debt.type === 'other' && debt.repayType === 'due_date' && debt.dueDatePayMode === 'installments' && debt.firstPaymentDate);
        if (isReplay) {
            const sched = generatePayoffSchedule(debt);
            const byMonth = {};
            sched.forEach(row => { byMonth[dtMonthKey(row.date)] = row; });
            const firstKey = sched.length ? dtMonthKey(sched[0].date) : curKey;
            const lastKey = sched.length ? dtMonthKey(sched[sched.length - 1].date) : curKey;
            info[d.id] = { replay: true, byMonth, firstKey, lastKey, apr: parseFloat(debt.apr) || 0, origBalance: parseFloat(debt.beginningBalance) || 0 };
            if (firstKey < minKey) minKey = firstKey;
        } else {
            const hist = getDebtPaidHistoryByMonth(debt);
            const overdue = getDebtOverdueByMonth(debt);
            info[d.id] = { replay: false, hist, overdue, minPay: d.minPay, apr: d.apr, curBalance: d.balance };
            Object.keys(hist).concat(Object.keys(overdue)).forEach(k => { if (k < minKey) minKey = k; });
        }
    });

    const virtualBal = {};
    const nonReplayBal = {};
    ordered.forEach(d => {
        if (info[d.id].replay) virtualBal[d.id] = info[d.id].origBalance;
        else nonReplayBal[d.id] = info[d.id].curBalance;
    });

    let cursor = new Date(parseInt(minKey.slice(0, 4)), parseInt(minKey.slice(5, 7)) - 1, 1);
    const rows = [];
    let totalInterest = 0;
    let guard = 0;
    let done = false;

    while (!done && guard++ < 1200) {
        const k = dtMonthKey(cursor);
        const reqs = {};       // redistribution-eligible amount due this month
        const dueDisplay = {}; // display-only overdue amount (non-replay past, not part of redistribution)
        const already = {};    // real money already paid this month
        const extraEligible = {};
        let reqSum = 0;

        ordered.forEach(d => {
            const inf = info[d.id];
            if (inf.replay) {
                const row = inf.byMonth[k];
                if (!row) { reqs[d.id] = 0; already[d.id] = 0; extraEligible[d.id] = false; return; }
                if (row.paid) {
                    already[d.id] = row.actualPaid != null ? row.actualPaid : row.payment;
                    reqs[d.id] = 0;
                    extraEligible[d.id] = false;
                    virtualBal[d.id] = row.balance;
                } else {
                    inf._interestThisMonth = virtualBal[d.id] * (inf.apr / 100 / 12);
                    reqs[d.id] = row.payment || 0;
                    already[d.id] = 0;
                    extraEligible[d.id] = virtualBal[d.id] > 0.005;
                }
            } else {
                const paidSoFar = inf.hist[k] || 0;
                const isFullyPaid = paidSoFar >= inf.minPay - 0.01;
                if (Math.abs(paidSoFar) > 0.005 && isFullyPaid) {
                    // Fully paid (or overpaid) this month — settled, don't ask for more.
                    already[d.id] = paidSoFar;
                    dueDisplay[d.id] = inf.overdue[k] || 0;
                    reqs[d.id] = 0;
                    extraEligible[d.id] = false;
                } else if (k < curKey) {
                    // Past month — only informational, doesn't feed this month's redistribution.
                    already[d.id] = paidSoFar;
                    dueDisplay[d.id] = inf.overdue[k] || 0;
                    reqs[d.id] = 0;
                    extraEligible[d.id] = false;
                } else if (nonReplayBal[d.id] <= 0.005) {
                    reqs[d.id] = 0; already[d.id] = paidSoFar; extraEligible[d.id] = false;
                } else {
                    // Current/future, partially paid (or not at all) — still owes the remainder.
                    const remaining = Math.max(inf.minPay - paidSoFar, 0);
                    reqs[d.id] = Math.min(remaining, nonReplayBal[d.id]);
                    already[d.id] = paidSoFar;
                    extraEligible[d.id] = true;
                }
            }
            reqSum += reqs[d.id] || 0;
        });

        // Money already paid this month (e.g. a debt settled outside the redistribution pool)
        // comes out of the entered budget first — it doesn't free up extra room for others.
        const alreadySum = ordered.reduce((s, d) => s + (already[d.id] || 0), 0);
        const entered = parseFloat(budgets[k]) || 0;
        const pool0 = Math.max(entered - alreadySum, reqSum);
        let pool = pool0;
        const pays = {};
        ordered.forEach(d => {
            if (!reqs[d.id]) return;
            const pay = Math.min(reqs[d.id], pool);
            pays[d.id] = pay;
            pool -= pay;
        });
        if (pool > 0.005) {
            const target = ordered.find(d => extraEligible[d.id]);
            if (target) { pays[target.id] = (pays[target.id] || 0) + pool; pool = 0; }
        }

        ordered.forEach(d => {
            const inf = info[d.id];
            if (inf.replay) {
                const row = inf.byMonth[k];
                if (!row || row.paid) return;
                const interest = inf._interestThisMonth || 0;
                totalInterest += interest;
                const principal = Math.min(Math.max((pays[d.id] || 0) - interest, 0), virtualBal[d.id]);
                virtualBal[d.id] = Math.max(virtualBal[d.id] - principal, 0);
            } else if (k >= curKey && nonReplayBal[d.id] > 0.005) {
                const interest = nonReplayBal[d.id] * (inf.apr / 100 / 12);
                totalInterest += interest;
                const principal = Math.min(Math.max((pays[d.id] || 0) - interest, 0), nonReplayBal[d.id]);
                nonReplayBal[d.id] = Math.max(nonReplayBal[d.id] - principal, 0);
            }
        });

        const total = ordered.reduce((s, d) => s + (already[d.id] || 0) + (pays[d.id] || 0), 0);
        const remaining = ordered.reduce((s, d) => {
            const inf = info[d.id];
            if (inf.replay) {
                if (k < inf.firstKey) return s + inf.origBalance;
                if (k > inf.lastKey) return s;
                return s + virtualBal[d.id];
            }
            return s + (k < curKey ? inf.curBalance : nonReplayBal[d.id]);
        }, 0);

        rows.push({
            key: k, date: new Date(cursor), pays, reqs, already, dueDisplay, reqSum,
            total, remaining: parseFloat(remaining.toFixed(2)), entered,
            short: entered > 0 && entered < reqSum - 0.005,
            isPast: k < curKey
        });

        const replayPending = ordered.some(d => info[d.id].replay && k <= info[d.id].lastKey && virtualBal[d.id] > 0.005);
        const nonReplayPending = ordered.some(d => !info[d.id].replay && nonReplayBal[d.id] > 0.005);
        if (k >= curKey && !replayPending && !nonReplayPending) done = true;

        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return { rows, months: rows.length, totalInterest, done };
}

function renderDebtPlanCard() {
    const planDebts = getPlanDebts();
    if (!planDebts.length) return '';

    const plan = data.debtPlan || { strategy: 'snowball', monthlyBudgets: {}, customOrder: [] };
    const strategy = plan.strategy || 'snowball';
    const budgets = plan.monthlyBudgets && typeof plan.monthlyBudgets === 'object' ? plan.monthlyBudgets : {};
    const ordered = orderPlanDebts(planDebts);
    const totalBalance = ordered.reduce((s, d) => s + d.balance, 0);

    const chevronSvg = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 8 10 13 15 8"/></svg>`;

    const planHelp = `Each row is a month, from the first payment to debt-free.&lt;br&gt;&lt;br&gt;&lt;strong&gt;Paid months&lt;/strong&gt; show the real amount you paid and never change.&lt;br&gt;&lt;strong&gt;Unpaid months&lt;/strong&gt; — past (red, overdue) or future — are all part of the same live plan: enter a Monthly Budget to cover them. It should cover the scheduled payments; everything above them goes to the target debt 🎯 by your strategy. When a debt is paid off, its payment rolls into the next one.&lt;br&gt;&lt;br&gt;Only unpaid months are recalculated — already-paid ones stay untouched. You can switch strategy anytime.`;

    const titleHelp = `<span class="help-icon" data-help-title="Payoff Plan" data-help="${planHelp}">💰</span>`;

    if (!dtPlanExpanded) {
        return `
        <div class="dt-plan-card">
          <div class="dt-plan-header" onclick="if(event.target.closest('.help-icon'))return;toggleDtPlanExpand()">
            <span class="dt-plan-title">${titleHelp} Payoff Plan · ${strategy === 'snowball' ? 'Snowball' : strategy === 'avalanche' ? 'Avalanche' : 'Custom'}</span>
            <div class="dt-plan-collapsed-info">
                <span class="dt-debt-balance">${formatMoney(totalBalance)}</span>
                <span class="dt-debt-balance-label">Total Debt</span>
            </div>
            <div class="acc-page-chevron">${chevronSvg}</div>
          </div>
        </div>`;
    }

    const strategyDefs = [
        { key: 'snowball',  emoji: '❄️', label: 'Snowball',  help: 'Pay the smallest balance first. Quick wins that keep you motivated — the surplus attacks the smallest debt until it disappears, then rolls into the next one.' },
        { key: 'avalanche', emoji: '🏔️', label: 'Avalanche', help: 'Pay the highest APR first. Mathematically optimal — saves the most interest overall.' },
        { key: 'custom',    emoji: '✏️', label: 'Custom',    help: 'Your own priority order. Drag the column headers in the table below to arrange which debt gets the extra money first.' }
    ];
    const pills = strategyDefs.map(s =>
        `<button class="dt-plan-pill${strategy === s.key ? ' dt-plan-pill--active' : ''}" onclick="if(event.target.classList.contains('help-icon'))return;setDtPlanStrategy('${s.key}')"><span class="help-icon" data-help-title="${s.label}" data-help="${s.help}">${s.emoji}</span> ${s.label}</button>`
    ).join('');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const curMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const curKey = dtMonthKey(curMonth);
    const fmtMonthDate = d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    // Unified timeline — one row per month, whether past (overdue/paid) or future (projected).
    // Only unpaid months are editable/redistributed; paid months are frozen at their real amounts.
    const sim = simulateDtPlanForward(ordered, budgets);

    const curSym = String(data.settings.currencySymbol || "").split("|")[0];
    const curBefore = data.settings.currencyPosition === "before";

    const bodyRows = sim.rows.map(row => {
        const cells = ordered.map(d => {
            const paid = row.already[d.id] || 0;
            const due = row.dueDisplay ? (row.dueDisplay[d.id] || 0) : 0;
            const pay = row.pays[d.id] || 0;
            if (paid > 0.005 && pay <= 0.005) {
                return `<td class="dt-plan-debtcol dt-plan-cell--paid"><span class="dt-plan-cell-check">✓</span> ${formatMoney(paid)}</td>`;
            }
            if (pay > 0.005) {
                const isExtra = pay > (row.reqs[d.id] || 0) + 0.005;
                if (paid > 0.005) {
                    const total = paid + (row.reqs[d.id] || 0);
                    return `<td class="dt-plan-debtcol dt-plan-cell--stacked${isExtra ? ' dt-plan-cell--extra' : ''}">
                        <span class="dt-plan-cell-paidamt">${formatMoney(paid)}</span>
                        <span>/ ${formatMoney(total)}${isExtra ? ' 🎯' : ''}</span>
                    </td>`;
                }
                return `<td class="dt-plan-debtcol${isExtra ? ' dt-plan-cell--extra' : ''}">${isExtra ? '🎯 ' : ''}${formatMoney(pay)}</td>`;
            }
            if (due > 0.005) return `<td class="dt-plan-debtcol dt-plan-cell--due">${formatMoney(due)}</td>`;
            return '<td class="dt-plan-debtcol">—</td>';
        }).join('');
        const curSpan = `<span class="dt-plan-budget-currency">${escapeHtml(curSym)}</span>`;
        const hasOpen = row.reqSum > 0.005 || Object.values(row.dueDisplay || {}).some(v => v > 0.005);
        const hasOverdue = row.isPast && hasOpen;
        const isCurrentSettled = row.key === curKey && !hasOpen;
        const rowCls = isCurrentSettled ? ' class="dt-plan-row--done"'
            : row.key === curKey ? ' class="dt-plan-row--current"'
            : hasOverdue ? ' class="dt-plan-row--overdue"'
            : row.isPast ? ' class="dt-plan-row--done"'
            : '';
        return `<tr${rowCls}>
            <td class="dt-plan-month">${fmtMonthDate(row.date)}</td>
            ${cells}
            <td class="dt-plan-budget">
                <span class="dt-plan-budget-wrap${row.short ? ' dt-plan-budget-wrap--short' : ''}${curBefore ? '' : ' dt-plan-budget-wrap--after'}">
                    ${curBefore ? curSpan : ''}
                    <input type="number" min="0" step="0.01"
                        class="dt-plan-budget-cell"
                        value="${row.entered > 0 ? Number(row.entered).toFixed(2) : ''}"
                        placeholder="${(row.reqSum > 0.005 ? row.reqSum : Math.abs(row.total)).toFixed(2)}"
                        onchange="setDtPlanMonthBudget('${row.key}', this.value)">
                    ${curBefore ? '' : curSpan}
                </span>
            </td>
            <td class="dt-plan-total">${Math.abs(row.total) > 0.005 ? formatMoney(row.total) : '—'}</td>
            <td class="dt-plan-remaining">${formatMoney(row.remaining)}</td>
        </tr>`;
    }).join('');

    const headCells = ordered.map(d => `
        <th class="dt-plan-debtcol${strategy === 'custom' ? ' dt-plan-debtcol--draggable' : ''}" data-id="${d.id}">
            <span class="dt-plan-col-name">${escapeHtml(d.name)}</span>
            <span class="dt-plan-col-sub">${formatMoney(d.balance)} · ${d.apr.toFixed(2)}%</span>
        </th>`).join('');

    // Projections
    let projectionHtml = '';
    if (sim.done && sim.rows.length) {
        const freeDate = fmtMonthDate(sim.rows[sim.rows.length - 1].date);
        const anyBudget = sim.rows.some(r => r.entered > 0);
        let saved = 0;
        if (anyBudget) {
            const baseline = simulateDtPlanForward(ordered, {});
            saved = baseline.done ? Math.max(baseline.totalInterest - sim.totalInterest, 0) : 0;
        }
        const targetName = ordered[0] ? ordered[0].name : '';
        projectionHtml = `
        <div class="dt-plan-summary-box">
            <span>${anyBudget
                ? `Anything above the scheduled payments goes to <strong>🎯 ${escapeHtml(targetName)}</strong> — you can switch strategy anytime.`
                : `Enter a Monthly Budget in the table — anything above the scheduled payments attacks <strong>🎯 ${escapeHtml(targetName)}</strong>.`}</span>
            <span>Debt-free by <strong>${freeDate}</strong> · Interest: <strong>${formatMoney(sim.totalInterest)}</strong>${saved > 0.005 ? ` · Saved vs minimums: <strong>${formatMoney(saved)}</strong>` : ''}</span>
        </div>`;
        if (sim.rows.some(r => r.short)) {
            projectionHtml = `
        <div class="dt-plan-warning">⚠️ Some monthly budgets (red) are below the scheduled payments for that month — those months use the scheduled amounts instead.</div>` + projectionHtml;
        }
    }

    return `
    <div class="dt-plan-card dt-plan-card--open">
      <div class="dt-plan-header" onclick="if(event.target.closest('.help-icon'))return;toggleDtPlanExpand()">
        <span class="dt-plan-title">${titleHelp} Payoff Plan</span>
        <div class="dt-plan-collapsed-info">
            <span class="dt-debt-balance">${formatMoney(totalBalance)}</span>
            <span class="dt-debt-balance-label">Total Debt</span>
        </div>
        <div class="acc-page-chevron acc-page-chevron--open">${chevronSvg}</div>
      </div>
      <div class="dt-plan-body">
        <div class="dt-plan-controls">
            <div class="dt-plan-pills">${pills}</div>
        </div>
        <div class="dt-plan-table-wrap">
            <table class="dt-plan-table">
                <thead>
                    <tr><th class="dt-plan-month">Month</th>${headCells}<th class="dt-plan-budget">Monthly Budget</th><th class="dt-plan-total">Total</th><th class="dt-plan-remaining">Balance</th></tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
        ${projectionHtml}
      </div>
    </div>`;
}

function toggleDtPlanExpand() {
    dtPlanExpanded = !dtPlanExpanded;
    localStorage.setItem('dtPlanExpanded', dtPlanExpanded ? '1' : '0');
    renderDebtPage();
}

function setDtPlanStrategy(strategy) {
    if (!data.debtPlan) data.debtPlan = { strategy: 'snowball', monthlyBudgets: {}, customOrder: [] };
    if (strategy === 'custom' && (!Array.isArray(data.debtPlan.customOrder) || !data.debtPlan.customOrder.length)) {
        // Seed the custom order from the currently displayed strategy order
        data.debtPlan.customOrder = orderPlanDebts(getPlanDebts()).map(d => d.id);
    }
    if (strategy === 'snowball' || strategy === 'avalanche') {
        // Re-lock the target order fresh at the moment of switching — from then on it stays
        // put until a debt is paid off/removed or a new one is added.
        const lockKey = strategy === 'avalanche' ? 'avalancheOrder' : 'snowballOrder';
        data.debtPlan[lockKey] = sortPlanDebtsFresh(getPlanDebts(), strategy).map(d => d.id);
    }
    data.debtPlan.strategy = strategy;
    saveData();
    renderDebtPage();
}

function setDtPlanMonthBudget(key, value) {
    if (!data.debtPlan) data.debtPlan = { strategy: 'snowball', monthlyBudgets: {}, customOrder: [] };
    if (!data.debtPlan.monthlyBudgets || typeof data.debtPlan.monthlyBudgets !== 'object') {
        data.debtPlan.monthlyBudgets = {};
    }
    const num = parseFloat(value);
    if (isFinite(num) && num > 0) {
        data.debtPlan.monthlyBudgets[key] = num;
    } else {
        delete data.debtPlan.monthlyBudgets[key];
    }

    // Sync the already-generated (unpaid) transaction for that month to the plan's amount —
    // only if the transaction exists; otherwise there's nothing to update.
    const ordered = orderPlanDebts(getPlanDebts());
    const sim = simulateDtPlanForward(ordered, data.debtPlan.monthlyBudgets);
    const row = sim.rows.find(r => r.key === key);
    if (row) {
        ordered.forEach(d => {
            const bill = (data.bills || []).find(b =>
                b.debtId === d.id && b.debtGenerated && !b.paid && b.dueDate && b.dueDate.slice(0, 7) === key
            );
            if (!bill) return;
            const pay = row.pays[d.id] || 0;
            const scheduled = parseFloat(bill.amount) || 0;
            if (pay > scheduled + 0.005) {
                bill.actualAmount = parseFloat(pay.toFixed(2));
            } else if (bill.actualAmount != null && bill.actualAmount > scheduled + 0.005) {
                bill.actualAmount = null;
            }
        });
    }

    saveData();
    renderDebtPage();
}

function initDtPlanDrag() {
    const headRow = document.querySelector('.dt-plan-table thead tr');
    if (!headRow || !headRow.querySelector('.dt-plan-debtcol--draggable')) return;

    const clearOver = () => headRow.querySelectorAll('th').forEach(t => t.classList.remove('drag-over'));

    const applyMove = (srcId, tgtId) => {
        if (!data.debtPlan || srcId === tgtId) return;
        const ids = [...headRow.querySelectorAll('th[data-id]')].map(t => t.dataset.id);
        const from = ids.indexOf(srcId);
        const to = ids.indexOf(tgtId);
        if (from === -1 || to === -1) return;
        ids.splice(from, 1);
        ids.splice(to, 0, srcId);
        data.debtPlan.customOrder = ids;
        saveData();
        renderDebtPage();
    };

    headRow.querySelectorAll('th.dt-plan-debtcol--draggable').forEach(th => {
        th.setAttribute('draggable', 'true');

        th.addEventListener('dragstart', e => {
            window._dtPlanDragSrc = th;
            th.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        th.addEventListener('dragend', () => {
            window._dtPlanDragSrc = null;
            th.classList.remove('dragging');
            clearOver();
        });
        th.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (window._dtPlanDragSrc && window._dtPlanDragSrc !== th) th.classList.add('drag-over');
        });
        th.addEventListener('dragleave', () => th.classList.remove('drag-over'));
        th.addEventListener('drop', e => {
            e.preventDefault();
            clearOver();
            const src = window._dtPlanDragSrc;
            window._dtPlanDragSrc = null;
            if (src && src !== th) applyMove(src.dataset.id, th.dataset.id);
        });

        th.addEventListener('touchstart', e => {
            window._dtPlanDragSrc = th;
            th.classList.add('dragging');
        }, { passive: true });
        th.addEventListener('touchmove', e => {
            e.preventDefault();
            const t = e.touches[0];
            const target = document.elementFromPoint(t.clientX, t.clientY)?.closest('.dt-plan-table th[data-id]');
            clearOver();
            if (target && target !== th) target.classList.add('drag-over');
        }, { passive: false });
        th.addEventListener('touchend', e => {
            th.classList.remove('dragging');
            clearOver();
            const t = e.changedTouches[0];
            const target = document.elementFromPoint(t.clientX, t.clientY)?.closest('.dt-plan-table th[data-id]');
            const src = window._dtPlanDragSrc;
            window._dtPlanDragSrc = null;
            if (src && target && target !== src) applyMove(src.dataset.id, target.dataset.id);
        });
    });
}

function updateDebtPaidOffStatus() {
    // Loans/Other are finite — once the balance hits zero the debt is truly done. Credit
    // cards are revolving (a new purchase brings the balance right back up), so they never
    // auto-close: $0 just means "nothing owed right now", not "this debt is finished".
    let changed = false;
    (data.debts || []).forEach(d => {
        if (d.type === 'credit_card') return;
        const isZero = getDebtBalance(d) <= 0.005;
        if (isZero && !d.paidOff) { d.paidOff = true; changed = true; }
        else if (!isZero && d.paidOff) { d.paidOff = false; changed = true; }
    });
    return changed;
}

function renderDebtPage() {
    const container = document.getElementById('debtPageContent');
    if (!container) return;

    if (updateDebtPaidOffStatus()) saveData();

    const debts = data.debts || [];

    if (debts.length === 0) {
        container.innerHTML = `
            <div class="dt-empty">
                <div class="dt-empty-icon">💳</div>
                <p>No debts added yet.</p>
                <button class="dt-add-btn" onclick="openDebtModal()">+ Add Debt</button>
            </div>`;
        renderDebtSummaryCards();
        return;
    }

    const dtTypeOptions = [
        { key: 'credit_card', label: 'Credit Cards' },
        { key: 'loan',        label: 'Loans' },
        { key: 'other',       label: 'Other' },
    ];
    const isTypeSelected = dtTypeOptions.some(f => f.key === dtFilter);

    const pillsHtml = `
        <button class="filter-pill${dtFilter === 'all' ? ' active' : ''}" onclick="setDtFilter('all')">All</button>
        <select class="filter-pill-select" onchange="setDtFilter(this.value || 'all')">
            <option value=""${!isTypeSelected ? ' selected' : ''}>All Types</option>
            ${dtTypeOptions.map(f => `<option value="${f.key}"${dtFilter === f.key ? ' selected' : ''}>${f.label}</option>`).join('')}
        </select>
        <button class="filter-pill${dtFilter === 'paidoff' ? ' dt-pill-active' : ''}" onclick="setDtFilter('paidoff')">Paid Off</button>
        <button class="filter-pill${dtFilter === 'archived' ? ' dt-pill-active' : ''}" onclick="setDtFilter('archived')">Archived</button>`;

    let filtered = debts.filter(d => {
        if (dtFilter === 'all')         return !d.archived;
        if (dtFilter === 'archived')    return !!d.archived;
        if (dtFilter === 'paidoff')     return !!d.paidOff && !d.archived;
        if (dtFilter === 'credit_card') return d.type === 'credit_card' && !d.paidOff && !d.archived;
        if (dtFilter === 'loan')        return d.type === 'loan' && !d.paidOff && !d.archived;
        if (dtFilter === 'other')       return d.type === 'other' && !d.paidOff && !d.archived;
        return true;
    });

    const planOrderIds = orderPlanDebts(getPlanDebts()).map(d => d.id);
    const sorted = [...filtered].sort((a, b) => {
        if (a.archived && !b.archived) return 1;
        if (!a.archived && b.archived) return -1;
        if (a.paidOff && !b.paidOff) return 1;
        if (!a.paidOff && b.paidOff) return -1;
        const ia = planOrderIds.indexOf(a.id);
        const ib = planOrderIds.indexOf(b.id);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return getDebtBalance(b) - getDebtBalance(a);
    });

    const cardsHtml = sorted.length > 0
        ? sorted.map(d => renderDebtCard(d)).join('')
        : `<div class="dt-empty-filter">No debts match this filter.</div>`;

    const closeSvg = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg>`;

    const dtPageHelp = `Track credit cards, loans and other debts — here's how to set it up.&lt;br&gt;&lt;br&gt;` +
        `&lt;strong&gt;Step 1 — Add your debts&lt;/strong&gt;&lt;br&gt;` +
        `Add each debt one by one, filling in the form (credit card, loan, or other). If you turn on &quot;Generate payment transactions,&quot; the app creates its monthly payments for you automatically.&lt;br&gt;` +
        `💳 Credit cards read their balance from the linked credit account. 🏦 Loans &amp; other debts start from the beginning balance and decrease as you pay.&lt;br&gt;` +
        `Once added, open a debt's card to see its full schedule. Planned payments also show up in Transaction List and Calendar.&lt;br&gt;` +
        `You can also add payments manually — but automatic generation is recommended, since the system already knows exactly what's due and when.&lt;br&gt;&lt;br&gt;` +
        `&lt;strong&gt;Step 2 — Choose a payoff plan&lt;/strong&gt;&lt;br&gt;` +
        `Open the &lt;strong&gt;💰 Payoff Plan&lt;/strong&gt; card at the top of this page. It shows all your debts together, month by month.&lt;br&gt;` +
        `Pick a strategy: Snowball, Avalanche, or Custom. Then enter a &lt;strong&gt;Monthly Budget&lt;/strong&gt; for any month.&lt;br&gt;` +
        `If your budget is more than all that month's installments added together, the extra money goes to the &lt;strong&gt;first debt in your list, for that same month&lt;/strong&gt;. This shortens how long it takes to pay off that debt.&lt;br&gt;` +
        `The extra amount is added automatically to the &lt;strong&gt;&quot;New/Paid Amount&quot;&lt;/strong&gt; field, on that debt's transaction for that month. It's ready and waiting — just mark the transaction Paid once you make the payment.&lt;br&gt;&lt;br&gt;` +
        `&lt;strong&gt;Step 3 — Keep it up to date&lt;/strong&gt;&lt;br&gt;` +
        `As you pay each installment, mark its transaction as Paid — every change (balances, schedule, payoff plan) updates everywhere automatically.&lt;br&gt;` +
        `✏️ Paid a different amount? Edit the transaction and enter the real sum in &quot;New/Paid Amount&quot; instead.&lt;br&gt;` +
        `➕ You can make several payments toward the same installment — paid in parts, or with extra on top. They all add up.&lt;br&gt;` +
        `💰 Each month, your money covers the interest first; the rest reduces the principal.`;

    container.innerHTML = `
        <div class="dt-toolbar">
            <div class="filters-bar" id="dtFiltersBar">
                <span class="row-label">
                    <span class="help-icon" data-help-title="Filters" data-help="Filter debts by type.">🎛️</span>
                    Filters:
                </span>
                <div class="filters-all-row" id="dtFiltersRow">${pillsHtml}</div>
            </div>
            <span class="help-icon" data-help-title="Debt Payments" data-help="${dtPageHelp}">ℹ️</span>
            <button class="dt-add-btn" onclick="openDebtModal()">+ Add Debt</button>
        </div>
        <div class="filters-mobile-bar" id="dtFiltersMobileBar">
            <button class="filters-mobile-toggle${dtFilter !== 'all' ? ' active' : ''}" id="dtFiltersToggleBtn">
                <span class="help-icon" data-help-title="Filters" data-help="Filter debts by type.">🎛️</span>
                Filters
            </button>
            <span class="help-icon" data-help-title="Debt Payments" data-help="${dtPageHelp}">ℹ️</span>
            <button class="dt-add-btn" onclick="openDebtModal()">+ Add Debt</button>
        </div>
        <div id="dtFiltersModal" class="filters-modal-overlay" style="display:none;">
            <div class="filters-modal-box">
                <div class="filters-modal-header">
                    <span class="row-label">Filters:</span>
                    <button class="modal-close-btn" id="dtFiltersModalClose">${closeSvg}</button>
                </div>
                <div class="filters-modal-body" id="dtFiltersModalBody"></div>
            </div>
        </div>
        ${renderDebtPlanCard()}
        <div class="dt-cards-list">${cardsHtml}</div>`;

    renderDebtSummaryCards();
    initDtPlanDrag();
    if (typeof initAllCustomSelects === 'function') initAllCustomSelects();

    document.getElementById('dtFiltersToggleBtn')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('help-icon')) return;
        const modal = document.getElementById('dtFiltersModal');
        const body  = document.getElementById('dtFiltersModalBody');
        const row   = document.getElementById('dtFiltersRow');
        if (modal && body && row) {
            body.appendChild(row);
            row.classList.add('in-modal');
            modal.style.display = 'flex';
        }
    });

    document.getElementById('dtFiltersModalClose')?.addEventListener('click', () => closeDtFiltersModal());
    document.getElementById('dtFiltersModal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDtFiltersModal();
    });
}

function toggleDtExpand(id) {
    const opening = expandedDtId !== id;
    expandedDtId = opening ? id : null;
    renderDebtPage();
    if (opening) {
        requestAnimationFrame(() => scrollDtScheduleToCurrent(id));
    }
}

function setDtFilter(filter) {
    dtFilter = filter;
    localStorage.setItem('dtStatusFilter', filter);
    renderDebtPage();
}

function closeDtFiltersModal() {
    const modal = document.getElementById('dtFiltersModal');
    const bar   = document.getElementById('dtFiltersBar');
    const row   = document.getElementById('dtFiltersRow');
    if (row && bar) { row.classList.remove('in-modal'); bar.appendChild(row); }
    if (modal) modal.style.display = 'none';
}

function openDebtsInfoModal() {
    if (localStorage.getItem("ultimatePaycheckDebtsSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("debtsInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeDebtsInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckDebtsSeen", "true");
    document.getElementById("debtsInfoModal").classList.remove("active");
}

window.generateDebtTransactions = generateDebtTransactions;
window.toggleDtExpand         = toggleDtExpand;
window.toggleDtScheduleAll   = toggleDtScheduleAll;
window.setDtFilter            = setDtFilter;
window.closeDtFiltersModal    = closeDtFiltersModal;
window.renderDebtSummaryCards = renderDebtSummaryCards;
window.closeDebtsInfoModal    = closeDebtsInfoModal;
