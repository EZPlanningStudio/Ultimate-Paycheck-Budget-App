let expandedSvId = null;

function renderSvFundTransactions(g) {
    const transactions = (data.bills || [])
        .filter(b => b.name === g.name && isSavingsCategory(b.category))
        .sort((a, b) => parseLocalDate(getBillDisplayDate(a)) - parseLocalDate(getBillDisplayDate(b)));

    if (transactions.length === 0) {
        return `<div class="acc-tx-empty">No transactions for this fund yet.</div>`;
    }

    let runningBalance = parseFloat(g.startAmount) || 0;
    let projectedBalance = runningBalance;

    const rows = transactions.map(bill => {
        const amount = parseFloat(getBillDisplayAmount(bill)) || 0;
        const delta = bill.type === "refund" ? -amount : amount;

        let displayBalance;
        let isProjected = false;
        if (bill.paid) {
            runningBalance += delta;
            projectedBalance = runningBalance;
            displayBalance = formatMoney(runningBalance);
        } else {
            projectedBalance += delta;
            displayBalance = formatMoney(projectedBalance);
            isProjected = true;
        }

        const dateStr = bill.actualDate || bill.dueDate;
        const displayDate = dateStr ? formatDisplayDate(parseLocalDate(dateStr)) : "—";
        const isPaid = bill.paid;
        const statusLabel = !isPaid ? "Planned"
            : bill.type === "refund" ? "Withdrawn"
            : bill.type === "interest" ? "Earned"
            : "Saved";

        const isWithdrawal = bill.fromAccount === g.accountId;
        const otherAccId = isWithdrawal ? bill.toAccount : bill.fromAccount;
        const otherAcc = otherAccId ? (data.accounts || []).find(a => a.id === otherAccId) : null;
        const otherLabel = otherAcc ? `${isWithdrawal ? "→ " : "← "}${escapeHtml(otherAcc.name)}` : (otherAccId === "external" ? `${isWithdrawal ? "→ " : "← "}🌐 External` : "");

        const amountCls = delta >= 0 ? "acc-tx-in" : "acc-tx-out";
        const balanceCls = isProjected ? "acc-tx-running--projected" : (runningBalance < 0 ? "acc-balance--negative" : "");

        return `
        <div class="acc-tx-row ${isPaid ? "acc-tx-paid" : "acc-tx-planned"} category-color-2${bill.type === "interest" ? " acc-tx-interest" : ""}">
          <div class="acc-tx-date">${displayDate}</div>
          <div class="acc-tx-name">
            <span class="acc-tx-name-main">${bill.type === "interest" ? "✦ " : ""}${escapeHtml(bill.name || "—")}</span>
            ${otherLabel ? `<span class="acc-tx-other">${otherLabel}</span>` : ""}
          </div>
          <div class="acc-tx-cat${bill.type === "interest" ? " acc-tx-cat--interest" : ""}">${bill.type === "interest" ? "Interest" : "Savings"}</div>
          <div class="acc-tx-status ${isPaid ? "acc-status-done" : "acc-status-planned"}">${statusLabel}</div>
          <div class="acc-tx-amount ${amountCls}">${delta >= 0 ? "+" : ""}${formatMoney(delta)}</div>
          <div class="acc-tx-running ${balanceCls}">${displayBalance}</div>
        </div>`;
    }).reverse().join("");

    return `
    <div class="acc-tx-table">
      <div class="acc-tx-header">
        <div class="acc-tx-date">Date</div>
        <div class="acc-tx-name">Transaction</div>
        <div class="acc-tx-cat">Category</div>
        <div class="acc-tx-status">Status</div>
        <div class="acc-tx-amount">Amount</div>
        <div class="acc-tx-running">Balance</div>
      </div>
      ${rows}
    </div>`;
}
let svFilter = localStorage.getItem('svStatusFilter') || 'all';

function svShowTip(el, lbl, type) {
    const tip = document.getElementById("svChartTip");
    if (!tip) return;
    const r = el.getBoundingClientRect();
    const chartRect = el.closest(".sv-chart").getBoundingClientRect();
    tip.textContent = lbl;
    tip.style.left = (r.left + r.width / 2 - chartRect.left) + "px";
    tip.style.top  = (r.top - chartRect.top) + "px";
    tip.className = type === "planned" ? "sv-chart-tip sv-chart-tip--planned" : "sv-chart-tip";
    tip.style.display = "";
}

function svHideTip() {
    const tip = document.getElementById("svChartTip");
    if (tip) tip.style.display = "none";
}

function getSvSavedAmount(g) {
    const startAmt = parseFloat(g.startAmount) || 0;
    const txTotal = (data.bills || [])
        .filter(b => b.paid && b.name === g.name && isSavingsCategory(b.category))
        .reduce((sum, b) => {
            const amt = parseFloat(getBillDisplayAmount(b)) || 0;
            return b.type === "refund" ? sum - amt : sum + amt;
        }, 0);
    return startAmt + txTotal;
}

function getSvGoalStatus(g) {
    if (g.archived) return 'archived';
    const saved = getSvSavedAmount(g);
    const target = parseFloat(g.goalAmount) || 0;
    if (target > 0 && saved >= target) return 'reached';
    if (g.goalDate) {
        const end = parseLocalDate(g.goalDate);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (today > end) return 'overdue';
    }
    return 'active';
}

function getSvMonthlyContribution(g) {
    // With a goal date: fixed amount computed once from the original terms (start amount,
    // start date, goal date) — stable, doesn't drift as "today" passes, matching how a fixed
    // loan payment is computed at debt.js. Without a goal date: the user's own flat entry.
    if (g.goalDate) {
        const start = parseLocalDate(g.startDate);
        const due = parseLocalDate(g.goalDate);
        const months = (due.getFullYear() - start.getFullYear()) * 12 + (due.getMonth() - start.getMonth()) + 1;
        const remaining = Math.max((parseFloat(g.goalAmount) || 0) - (parseFloat(g.startAmount) || 0), 0);
        if (months <= 0) return remaining;
        return remaining / months;
    }
    return parseFloat(g.monthlyContribution) || 0;
}

function generateSavingsSchedule(g) {
    // Mirrors generatePayoffSchedule in debt.js, but simpler — no interest concept, just a
    // running accumulation toward the goal. Stops generating rows once the goal is reached.
    const rows = [];
    const goalAmount = parseFloat(g.goalAmount) || 0;
    const startAmount = parseFloat(g.startAmount) || 0;
    if (goalAmount <= 0 || startAmount >= goalAmount - 0.005 || !g.startDate) return rows;

    const contribution = getSvMonthlyContribution(g);
    if (!contribution || contribution <= 0.005) return rows;

    const paidByDate = {};
    const pendingByDate = {};
    (data.bills || []).forEach(b => {
        if (b.name !== g.name || !isSavingsCategory(b.category)) return;
        if (b.paid) paidByDate[b.dueDate] = b;
        else pendingByDate[b.dueDate] = b;
    });

    let currentDate = parseLocalDate(g.startDate);
    let saved = startAmount;
    const MAX = 600;

    for (let i = 1; i <= MAX && saved < goalAmount - 0.005; i++) {
        const dateKey = toLocalDateInputValue(currentDate);
        const paidBill = paidByDate[dateKey];
        const pendingBill = pendingByDate[dateKey];

        let scheduledAmt = contribution;
        if (pendingBill) scheduledAmt = parseFloat(pendingBill.amount) || scheduledAmt;
        if (paidBill) scheduledAmt = parseFloat(paidBill.amount) || scheduledAmt;

        const realAmt = paidBill
            ? (paidBill.type === 'refund' ? -1 : 1) * (parseFloat(getBillDisplayAmount(paidBill)) || 0)
            : 0;
        const isPaidRow = !!paidBill;
        const totalAmt = isPaidRow ? realAmt : scheduledAmt;

        saved = parseFloat((saved + totalAmt).toFixed(2));
        rows.push({ nr: i, date: new Date(currentDate), amount: scheduledAmt, actualPaid: realAmt, saved, paid: isPaidRow });

        const next = new Date(currentDate);
        next.setMonth(next.getMonth() + 1);
        currentDate = next;
    }

    return rows;
}

function generateSavingsTransactions(g) {
    const fromAccount = g.txFromAccount || null;
    const toAccount = g.accountId || null;
    const priority = g.txPriority ?? 1;
    const seriesId = g.id;

    // Remove existing planned (not paid) generated transactions for this fund
    data.bills = data.bills.filter(b => !(b.savingsGoalId === g.id && b.savingsGenerated && !b.paid));

    // Sync name on paid generated transactions
    data.bills = data.bills.map(b =>
        (b.savingsGoalId === g.id && b.savingsGenerated && b.paid) ? { ...b, name: g.name } : b
    );

    const schedule = generateSavingsSchedule(g);

    // Never duplicate over a paid transaction with the same due date
    const paidDueDates = new Set(
        data.bills.filter(b => b.savingsGoalId === g.id && b.savingsGenerated && b.paid).map(b => b.dueDate)
    );

    const newBills = schedule
        .filter(row => !row.paid && !paidDueDates.has(toLocalDateInputValue(row.date)))
        .map(row => ({
            id: crypto.randomUUID(),
            seriesId,
            name: g.name,
            category: "Savings",
            type: "payment",
            amount: parseFloat(row.amount.toFixed(2)),
            actualAmount: null,
            dueDate: toLocalDateInputValue(row.date),
            actualDate: null,
            priority,
            frequency: "one-time",
            interval: 1,
            endDate: null,
            notes: "",
            paid: false,
            fromAccount,
            toAccount,
            savingsGoalId: g.id,
            savingsGenerated: true
        }));

    data.bills.push(...newBills);
}

function renderSavingsSummaryCards() {
    const goals = (data.savingsGoals || []).filter(g => !g.archived);
    let totalGoal = 0, totalSaved = 0, reached = 0;
    for (const g of goals) {
        const goalAmt = parseFloat(g.goalAmount) || 0;
        const saved = getSvSavedAmount(g);
        totalGoal  += goalAmt;
        totalSaved += saved;
        if (goalAmt > 0 && saved >= goalAmt) reached++;
    }
    const left = Math.max(0, totalGoal - totalSaved);
    const el = id => document.getElementById(id);
    if (el("svSumGoal"))    el("svSumGoal").textContent    = formatMoney(totalGoal);
    if (el("svSumSaved"))   el("svSumSaved").textContent   = formatMoney(totalSaved);
    if (el("svSumLeft"))    el("svSumLeft").textContent    = formatMoney(left);
    if (el("svSumReached")) el("svSumReached").textContent = `${reached} / ${goals.length}`;

    const existingIpb = document.getElementById("insightsProgressBar");
    if (existingIpb) existingIpb.remove();
    document.querySelector(".summary-grid-top")?.classList.remove("has-progress-bar");

    const pct = totalGoal > 0 ? Math.min((totalSaved / totalGoal) * 100, 100).toFixed(1) : 0;
    const ipb = document.createElement("div");
    ipb.id = "insightsProgressBar";
    ipb.className = "insights-progress-bar visible";
    ipb.innerHTML = `
        <div class="ipb-track">
            <div class="ipb-segments">
                <div class="ipb-segment sv-ipb-segment" style="width:${pct}%;"></div>
            </div>
        </div>
        <div class="ipb-labels-row">
            <span class="sv-ipb-label--saved">Saved <strong>${formatMoney(totalSaved)}</strong></span>
            <span class="sv-ipb-label--goal">Goal <strong>${formatMoney(totalGoal)}</strong></span>
        </div>`;
    document.querySelector(".summary-grid-wrap")?.appendChild(ipb);
    document.querySelector(".summary-grid-top")?.classList.add("has-progress-bar");
}

function toggleSvExpand(id) {
    expandedSvId = expandedSvId === id ? null : id;
    renderSavingsPage();

    if (expandedSvId) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const table = document.querySelector(`#sv-card-${expandedSvId} .acc-tx-table`);
            if (!table) return;
            const firstPaid = table.querySelector(".acc-tx-paid");
            if (!firstPaid) return;
            const rowH       = firstPaid.offsetHeight || 36;
            const tableTop   = table.getBoundingClientRect().top;
            const paidTop    = firstPaid.getBoundingClientRect().top;
            const contentPos = (paidTop - tableTop) + table.scrollTop;
            table.scrollTop  = Math.max(0, contentPos - rowH * 3);
        }));
    }
}

function renderSvCard(g) {
    const goalAmt    = parseFloat(g.goalAmount) || 0;
    const saved      = getSvSavedAmount(g);
    const left       = Math.max(0, goalAmt - saved);
    const pct        = goalAmt > 0 ? Math.min((saved / goalAmt) * 100, 100) : 0;
    const isComplete = goalAmt > 0 && saved >= goalAmt;
    const isExpanded = expandedSvId === g.id;
    const interestEarned = (data.bills || [])
        .filter(b => b.paid && b.type === "interest" && b.name === g.name && isSavingsCategory(b.category))
        .reduce((sum, b) => sum + (parseFloat(getBillDisplayAmount(b)) || 0), 0);

    const acc      = g.accountId ? (data.accounts || []).find(a => a.id === g.accountId) : null;
    const accLabel = acc ? escapeHtml(acc.name) : "No account linked";

    const cur = new Date().getFullYear();
    const startDate = g.startDate ? parseLocalDate(g.startDate) : null;
    const goalDate  = g.goalDate  ? parseLocalDate(g.goalDate)  : null;
    const spansMultiYear = (startDate && startDate.getFullYear() !== cur) || (goalDate && goalDate.getFullYear() !== cur);
    const fmtDesktop = d => d.toLocaleDateString("en-US", { day: "numeric", month: "short", ...(d.getFullYear() !== cur && { year: "numeric" }) });
    const fmtMobile  = d => spansMultiYear
        ? d.toLocaleDateString("en-US", { month: "short" }) + " '" + String(d.getFullYear()).slice(-2)
        : d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    const startD = startDate ? fmtDesktop(startDate) : "—";
    const goalD  = goalDate  ? fmtDesktop(goalDate)  : "ongoing";
    const startM = startDate ? fmtMobile(startDate)  : "—";
    const goalM  = goalDate  ? fmtMobile(goalDate)   : "ongoing";

    // Days left badge
    let daysHtml = "";
    if (g.archived) {
        daysHtml = `<span class="sv-badge sv-badge--archived">Archived</span>`;
    } else if (!isComplete && g.goalDate) {
        const diff = daysBetweenUTC(new Date(), parseLocalDate(g.goalDate));
        if (diff > 0)  daysHtml = `<span class="sv-badge sv-badge--days">${diff} days left</span>`;
        else           daysHtml = `<span class="sv-badge sv-badge--overdue">${Math.abs(diff)} days overdue</span>`;
    }

    const txHtml = isExpanded ? renderSvFundTransactions(g) : "";

    return `
    <div class="sv-fund-card${isComplete ? " sv-fund-card--complete" : ""}${g.archived ? " sv-fund-card--archived" : ""}" id="sv-card-${g.id}">
      <div class="sv-fund-header" onclick="toggleSvExpand('${g.id}')">
        <span class="sv-fund-name">${escapeHtml(g.name)}</span>
        <div class="sv-fund-saved-wrap">
          <span class="sv-fund-saved">${formatMoney(saved)}</span>
          <span class="sv-fund-saved-label">Saved</span>
        </div>
        <span class="sv-fund-account">${accLabel}</span>
        <div class="sv-fund-ctrls">
          <button class="mini-btn edit-btn app-tooltip-trigger sv-fund-edit" onclick="event.stopPropagation();openSavingsGoalModal('${g.id}')"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5 L16.5 6.5 L7 16 L3 17 L4 13 Z"/><line x1="11" y1="5.5" x2="14.5" y2="9"/></svg><span class="app-tooltip">Edit</span></button>
          <div class="acc-page-chevron${isExpanded ? " acc-page-chevron--open" : ""}">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="5 8 10 13 15 8"/>
            </svg>
          </div>
        </div>
      </div>
      <div class="sv-fund-progress">
        <div class="ipb-track">
          <div class="ipb-segments">
            <div class="ipb-segment" style="width:${pct.toFixed(1)}%;background:${g.archived ? 'var(--muted)' : (isComplete ? 'var(--mint)' : 'var(--purple)')};"></div>
          </div>
        </div>
        <div class="sv-fund-bar-labels">
          <span class="sv-fund-pct">${pct.toFixed(0)}%</span>
          <span class="sv-fund-of">${formatMoney(saved)} of ${formatMoney(goalAmt)}</span>
        </div>
        <div class="sv-fund-stats${interestEarned > 0 ? ' sv-fund-stats--with-interest' : ''}">
          <div class="sv-stat">
            <span class="sv-stat-label">Period</span>
            <span class="sv-stat-value sv-period-desktop">${startD} → ${goalD}</span>
            <span class="sv-stat-value sv-period-mobile">${startM} → ${goalM}</span>
          </div>
          <div class="sv-stat">
            <span class="sv-stat-label">Status</span>
            <span class="sv-stat-value">${daysHtml || (isComplete ? '<span class="sv-badge sv-badge--complete">✓ Reached</span>' : (!g.goalDate ? '<span class="sv-badge sv-badge--days">Ongoing</span>' : '—'))}</span>
          </div>
          <div class="sv-stat">
            <span class="sv-stat-label">Left to Save</span>
            <span class="sv-stat-value sv-stat-left">${isComplete ? '—' : formatMoney(left)}</span>
          </div>
          <div class="sv-stat">
            <span class="sv-stat-label">Monthly Target</span>
            <span class="sv-stat-value sv-stat-monthly">${(() => {
                if (isComplete || g.archived || left <= 0) return '—';
                const monthly = getSvMonthlyContribution(g);
                return monthly > 0.005 ? formatMoney(monthly) + '/mo' : '—';
            })()}</span>
          </div>
          ${interestEarned > 0 ? `
          <div class="sv-stat sv-stat--interest-cell">
            <span class="sv-stat-label">Interest Earned</span>
            <span class="sv-stat-value sv-stat-interest">${formatMoney(interestEarned)}</span>
          </div>` : ""}
        </div>
      </div>
      ${isExpanded ? `<div class="sv-fund-tx">${txHtml}</div>` : ""}
    </div>`;
}

let svChartData = null;
let svResizeTimer = null;
let svResizeHandler = null;

function renderSvChart() {
    const goals = data.savingsGoals || [];
    if (goals.length === 0) return "";
    const fundNames = goals.map(g => g.name);

    const allBills = (data.bills || [])
        .filter(b => isSavingsCategory(b.category) && fundNames.includes(b.name))
        .sort((a, b) => parseLocalDate(getBillDisplayDate(a)) - parseLocalDate(getBillDisplayDate(b)));
    const paidBills = allBills.filter(b => b.paid);
    if (allBills.length === 0) return "";

    const firstBill = parseLocalDate(getBillDisplayDate(allBills[0]));
    const chartStart = new Date(firstBill.getFullYear(), firstBill.getMonth(), 1);
    const goalDates = goals.filter(g => g.goalDate).map(g => parseLocalDate(g.goalDate));
    const latestGoal = goalDates.length > 0 ? new Date(Math.max(...goalDates)) : null;
    const lastBillDate = parseLocalDate(getBillDisplayDate(allBills[allBills.length - 1]));
    const endCandidate = latestGoal && latestGoal > lastBillDate ? latestGoal : lastBillDate;
    const chartEnd = new Date(endCandidate.getFullYear(), endCandidate.getMonth(), 1);

    const months = [];
    let cur = new Date(chartStart);
    while (cur <= chartEnd) { months.push(new Date(cur)); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
    if (months.length < 2) return "";

    const initBal = goals.reduce((s, g) => s + (parseFloat(g.startAmount) || 0), 0);
    const totalGoal = goals.reduce((s, g) => s + (parseFloat(g.goalAmount) || 0), 0);

    const lastPaidDate = paidBills.length > 0 ? parseLocalDate(getBillDisplayDate(paidBills[paidBills.length - 1])) : null;
    const lastPaidMonth = lastPaidDate ? new Date(lastPaidDate.getFullYear(), lastPaidDate.getMonth(), 1) : null;
    const actualPts = [];
    if (lastPaidMonth) {
        for (const m of months) {
            if (m > lastPaidMonth) break;
            const endOfM = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59);
            let bal = initBal;
            for (const b of paidBills) {
                const d = parseLocalDate(getBillDisplayDate(b));
                if (d > endOfM) continue;
                const amt = parseFloat(getBillDisplayAmount(b)) || 0;
                bal += b.type === "refund" ? -amt : amt;
            }
            actualPts.push({ m, v: bal });
        }
    }

    const plannedPts = [];
    for (const m of months) {
        const endOfM = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59);
        let bal = initBal;
        for (const b of allBills) {
            const d = parseLocalDate(getBillDisplayDate(b));
            if (d > endOfM) continue;
            const amt = parseFloat(b.amount) || 0;
            bal += b.type === "refund" ? -amt : amt;
        }
        plannedPts.push({ m, v: bal });
    }

    if (actualPts.length === 0 && plannedPts.length < 2) return "";

    const hasPlan = plannedPts.length > 1;
    const legend = `<div class="sv-chart-legend">
        <span class="sv-legend-item"><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="var(--purple)" stroke-width="2.5"/></svg>Actual</span>
        ${hasPlan ? `<span class="sv-legend-item"><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="var(--purple)" stroke-width="2" stroke-dasharray="6,4" opacity="0.6"/></svg>Planned</span>` : ""}
    </div>`;

    svChartData = { months, actualPts, plannedPts, totalGoal, chartStart, chartEnd };

    return `<div class="sv-chart" id="svChartContainer">
        <div class="sv-chart-tip" id="svChartTip" style="display:none;"></div>
        <div class="sv-chart-header">
            <span class="sv-chart-title">SAVINGS TREND</span>
            ${legend}
        </div>
        <svg id="svChartSvg" style="display:block;width:100%;"></svg>
    </div>`;
}

function drawSvChartSvg() {
    if (!svChartData) return;
    const svgEl = document.getElementById("svChartSvg");
    if (!svgEl) return;

    const W = Math.floor(svgEl.getBoundingClientRect().width);
    if (W < 60) return;

    const { months: allMonths, actualPts: allActual, plannedPts: allPlanned, totalGoal } = svChartData;

    const isMobile = W < 550;
    const isTablet = W >= 550 && W < 800;
    const threshold   = isMobile ? 12 : isTablet ? 18 : 24;
    const futureExtra = isMobile ? 2  : isTablet ? 3  : 4;

    let months, actualPts, plannedPts;
    if (allMonths.length > threshold) {
        const now = new Date();
        const actualMonthCount = allActual.length;
        const futureCap = actualMonthCount >= threshold - futureExtra ? futureExtra : threshold - actualMonthCount;
        const capEnd   = new Date(now.getFullYear(), now.getMonth() + futureCap, 1);
        const capStart = new Date(capEnd.getFullYear(), capEnd.getMonth() - threshold + 1, 1);
        const startMonth = capStart > allMonths[0] ? capStart : allMonths[0];
        months     = allMonths.filter(m => m >= startMonth && m <= capEnd);
        actualPts  = allActual.filter(p => p.m >= startMonth && p.m <= capEnd);
        plannedPts = allPlanned.filter(p => p.m >= startMonth && p.m <= capEnd);
        if (months.length < 2) { months = allMonths; actualPts = allActual; plannedPts = allPlanned; }
    } else {
        months = allMonths; actualPts = allActual; plannedPts = allPlanned;
    }

    const chartStart = months[0];
    const chartEnd   = months[months.length - 1];

    const titleEl = document.querySelector("#svChartContainer .sv-chart-title");
    if (titleEl) {
        const fmt = m => m.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        titleEl.textContent = `SAVINGS TREND  ·  ${fmt(chartStart)} – ${fmt(chartEnd)}`;
    }

    // Responsive layout — all values in real pixels
    const pL = Math.round(Math.max(42, Math.min(52, W * 0.09)));
    const pR = 10, pT = 12, pB = 24;
    const H = Math.round(Math.max(110, Math.min(170, W * 0.2)));
    const cW = W - pL - pR, cH = H - pT - pB;

    const allVals = [...actualPts.map(p => p.v), ...plannedPts.map(p => p.v), 0];
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals) || 1;
    const vRange = maxV - minV || 1;

    const xOf = m => (pL + ((m - chartStart) / (chartEnd - chartStart || 1)) * cW).toFixed(1);
    const yOf = v => (pT + cH - ((v - minV) / vRange) * cH).toFixed(1);

    const labelStep = 1;
    const fontSize = W < 380 ? 9 : 10;

    let gridLines = "";
    for (let i = 0; i <= 4; i++) {
        const v = minV + (vRange * i / 4);
        const y = yOf(v);
        const lbl = v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${Math.round(v)}`;
        gridLines += `<line x1="${pL}" y1="${y}" x2="${W - pR}" y2="${y}" stroke="var(--line)" stroke-width="0.5"/>
        <text x="${pL - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="${fontSize}" fill="var(--muted)">${lbl}</text>`;
    }

    const spansYears = months[0].getFullYear() !== months[months.length - 1].getFullYear();
    let xLabels = "";
    months.filter((_, i) => i % labelStep === 0 || i === months.length - 1).forEach((m, i) => {
        const showYear = spansYears && (i === 0 || m.getMonth() === 0);
        const lbl = showYear
            ? m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
            : m.toLocaleDateString('en-US', { month: 'short' });
        xLabels += `<text x="${xOf(m)}" y="${H - 6}" text-anchor="middle" font-size="${fontSize}" fill="var(--muted)">${lbl}</text>`;
    });

    const toPoints = pts => pts.map(p => `${xOf(p.m)},${yOf(p.v)}`).join(" ");
    const actualLine = actualPts.length > 1
        ? `<polyline points="${toPoints(actualPts)}" fill="none" stroke="var(--purple)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : "";
    const plannedLine = plannedPts.length > 1
        ? `<polyline points="${toPoints(plannedPts)}" fill="none" stroke="var(--purple)" stroke-width="2" stroke-dasharray="6,4" stroke-linecap="round" opacity="0.6"/>` : "";

    let dots = "";
    plannedPts.forEach(p => {
        const x = xOf(p.m), y = yOf(p.v);
        const lbl = p.v >= 1000 ? `$${(p.v/1000).toFixed(1)}k` : `$${Math.round(p.v)}`;
        dots += `<circle cx="${x}" cy="${y}" r="4" fill="white" stroke="var(--purple)" stroke-width="1.5" opacity="0.7" style="cursor:pointer;" onmouseenter="svShowTip(this,'${lbl}','planned')" onmouseleave="svHideTip()"/>`;
    });
    actualPts.forEach(p => {
        const x = xOf(p.m), y = yOf(p.v);
        const lbl = p.v >= 1000 ? `$${(p.v/1000).toFixed(1)}k` : `$${Math.round(p.v)}`;
        dots += `<circle cx="${x}" cy="${y}" r="5" fill="var(--purple)" stroke="white" stroke-width="1.5" style="cursor:pointer;" onmouseenter="svShowTip(this,'${lbl}')" onmouseleave="svHideTip()"/>`;
    });

    svgEl.removeAttribute("width");
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svgEl.setAttribute("height", H);
    svgEl.innerHTML = `${gridLines}${xLabels}${actualLine}${plannedLine}${dots}`;
}

function renderSavingsPage() {
    const container = document.getElementById("savingsPageContent");
    if (!container) return;

    const goals = data.savingsGoals || [];

    if (goals.length === 0) {
        container.innerHTML = `
            <div class="sv-empty">
                <div class="sv-empty-icon">🐷</div>
                <p>No savings funds yet.</p>
                <button class="sv-add-btn" onclick="openSavingsGoalModal()">+ Add Fund</button>
            </div>`;
        renderSavingsSummaryCards();
        return;
    }

    const goalsWithStatus = goals.map(g => ({ goal: g, status: getSvGoalStatus(g) }));

    let filtered;
    if (svFilter === 'all') {
        filtered = goalsWithStatus;
    } else {
        filtered = goalsWithStatus.filter(({ status }) => status === svFilter);
    }

    const sorted = [...filtered].sort((a, b) => {
        const rank = s => s === 'active' ? 0 : s === 'overdue' ? 1 : s === 'reached' ? 2 : 3;
        return rank(a.status) - rank(b.status);
    });

    const filterDefs = [
        { key: 'all', label: 'All' },
        { key: 'active', label: 'Active' },
        { key: 'reached', label: 'Reached' },
        { key: 'overdue', label: 'Overdue' },
        { key: 'archived', label: 'Archived' },
    ];

    const pillsHtml = filterDefs.map(f => {
        let cls = 'filter-pill';
        if (svFilter === f.key) cls += f.key === 'all' ? ' active' : ' sv-pill-active';
        return `<button class="${cls}" onclick="setSvFilter('${f.key}')">${f.label}</button>`;
    }).join('');

    const closeSvg = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg>`;
    const chartHtml = renderSvChart();
    const cardsHtml = sorted.length > 0
        ? sorted.map(({ goal }) => renderSvCard(goal)).join('')
        : `<div class="sv-empty-filter"><p>No funds match this filter.</p></div>`;

    const svPageHelp = `Track your savings funds — here's how to set it up.&lt;br&gt;&lt;br&gt;` +
        `&lt;strong&gt;Step 1 — Add your funds&lt;/strong&gt;&lt;br&gt;` +
        `Add each fund one by one: a name, a start amount (what you've already saved), a goal amount, and a start date. Add a goal date if you have a deadline — leave it blank for an ongoing fund with no fixed end.&lt;br&gt;` +
        `If you turn on &quot;Generate contribution transactions,&quot; the app creates your future contributions for you automatically. 🗓️ With a goal date, it calculates a fixed monthly amount to reach your goal exactly on time. 🔁 Without one, you set your own fixed Monthly Contribution instead.&lt;br&gt;&lt;br&gt;` +
        `&lt;strong&gt;Step 2 — Track your progress&lt;/strong&gt;&lt;br&gt;` +
        `Each fund's card shows a progress bar, its period (start → goal date, or &quot;ongoing&quot;), status, how much is left to save, and your monthly target.&lt;br&gt;` +
        `Once the goal amount is reached, the card shows &quot;✓ Reached&quot; and stops generating new planned contributions. You can still add money manually anytime — and if you want to keep saving automatically, just raise the goal amount to restart generation toward a new target.&lt;br&gt;&lt;br&gt;` +
        `&lt;strong&gt;Step 3 — Keep it up to date&lt;/strong&gt;&lt;br&gt;` +
        `As you make a contribution, mark its transaction as Paid — everything updates automatically.&lt;br&gt;` +
        `➕ You can add manual Deposit, Withdrawal, or Interest transactions any time, for any fund, whether or not automatic generation is on.&lt;br&gt;` +
        `🗑️ Changed your mind about the plan? Use &quot;Delete all planned contributions&quot; in the fund's edit screen to clear future ones and start fresh.&lt;br&gt;` +
        `📦 Done with a fund but want to keep its history? Archive it — it's hidden from the active list but never deleted.`;

    container.innerHTML = `
        <div class="sv-toolbar">
            <div class="filters-bar" id="svFiltersBar">
                <span class="row-label">
                    <span class="help-icon" data-help-title="Filters" data-help="Filter savings funds by status.">🎛️</span>
                    Filters:
                </span>
                <div class="filters-all-row" id="svFiltersRow">${pillsHtml}</div>
            </div>
            <span class="help-icon" data-help-title="Savings Funds" data-help="${svPageHelp}">ℹ️</span>
            <button class="sv-add-btn" onclick="openSavingsGoalModal()">+ Add Fund</button>
        </div>
        <div class="filters-mobile-bar" id="svFiltersMobileBar">
            <button class="filters-mobile-toggle${svFilter !== 'all' ? ' active' : ''}" id="svFiltersToggleBtn">
                <span class="help-icon" data-help-title="Filters" data-help="Filter savings funds by status.">🎛️</span>
                Filters
            </button>
            <span class="help-icon" data-help-title="Savings Funds" data-help="${svPageHelp}">ℹ️</span>
            <button class="sv-add-btn" onclick="openSavingsGoalModal()">+ Add Fund</button>
        </div>
        <div id="svFiltersModal" class="filters-modal-overlay" style="display:none;">
            <div class="filters-modal-box">
                <div class="filters-modal-header">
                    <span class="row-label">Filters:</span>
                    <button class="modal-close-btn" id="svFiltersModalClose">${closeSvg}</button>
                </div>
                <div class="filters-modal-body" id="svFiltersModalBody"></div>
            </div>
        </div>
        ${chartHtml}
        <div class="sv-cards-list">${cardsHtml}</div>`;

    renderSavingsSummaryCards();

    document.getElementById("svFiltersToggleBtn")?.addEventListener("click", (e) => {
        if (e.target.classList.contains("help-icon")) return;
        const modal = document.getElementById("svFiltersModal");
        const body  = document.getElementById("svFiltersModalBody");
        const row   = document.getElementById("svFiltersRow");
        if (modal && body && row) {
            body.appendChild(row);
            row.classList.add("in-modal");
            modal.style.display = "flex";
        }
    });

    document.getElementById("svFiltersModalClose")?.addEventListener("click", () => closeSvFiltersModal());
    document.getElementById("svFiltersModal")?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeSvFiltersModal();
    });

    if (svResizeHandler) {
        window.removeEventListener("resize", svResizeHandler);
        svResizeHandler = null;
    }

    if (chartHtml) {
        requestAnimationFrame(drawSvChartSvg);
        svResizeHandler = function() {
            clearTimeout(svResizeTimer);
            svResizeTimer = setTimeout(drawSvChartSvg, 80);
        };
        window.addEventListener("resize", svResizeHandler);
    }
}

function setSvFilter(status) {
    svFilter = status;
    localStorage.setItem('svStatusFilter', status);
    renderSavingsPage();
}

function closeSvFiltersModal() {
    const modal = document.getElementById("svFiltersModal");
    const bar   = document.getElementById("svFiltersBar");
    const row   = document.getElementById("svFiltersRow");
    if (row && bar) { row.classList.remove("in-modal"); bar.appendChild(row); }
    if (modal) modal.style.display = "none";
}

function openSavingsInfoModal() {
    if (localStorage.getItem("ultimatePaycheckSavingsSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("savingsInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeSavingsInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckSavingsSeen", "true");
    document.getElementById("savingsInfoModal").classList.remove("active");
}

window.setSvFilter = setSvFilter;
window.closeSvFiltersModal = closeSvFiltersModal;
window.toggleSvExpand = toggleSvExpand;
window.closeSavingsInfoModal = closeSavingsInfoModal;
