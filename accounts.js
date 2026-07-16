// ============================================================
// Ultimate Paycheck Budget App — accounts.js
// ============================================================

let expandedAccountId  = null;
let accFiltersLoaded   = false;

// ── Filter helpers ──────────────────────────────────────────

function populateAccFilterSelects() {
    const monthSel = document.getElementById("accFilterMonth");
    const yearSel  = document.getElementById("accFilterYear");
    if (!monthSel || !yearSel) return;

    const typeSel = document.getElementById("accFilterType");
    let savedMonth, savedYear, savedType;

    if (!accFiltersLoaded) {
        savedMonth = localStorage.getItem("ultimatePaycheckAccMonthFilter") || "";
        savedYear  = localStorage.getItem("ultimatePaycheckAccYearFilter")  || "";
        savedType  = localStorage.getItem("ultimatePaycheckAccTypeFilter")  || "";
        accFiltersLoaded = true;
    } else {
        savedMonth = monthSel.value;
        savedYear  = yearSel.value;
        savedType  = typeSel?.value ?? "";
    }
    if (typeSel) {
        typeSel.innerHTML = `
            <option value="">All Types</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="savings">Savings</option>
            <option value="credit">Credit</option>
            <option value="investment">Investment</option>`;
        typeSel.value = savedType;
    }

    const months = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];
    monthSel.innerHTML = '<option value="">All Months</option>' +
        months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");

    const years = [...new Set(
        (data.bills || []).filter(b => getBillDisplayDate(b))
            .map(b => parseLocalDate(getBillDisplayDate(b)).getFullYear())
    )].sort();
    yearSel.innerHTML = '<option value="">All Years</option>' +
        years.map(y => `<option value="${y}">${y}</option>`).join("");

    monthSel.value = savedMonth;
    yearSel.value  = savedYear;
}

// ── Balance calculation ─────────────────────────────────────

function calcAccountBalance(accountId, monthFilter, yearFilter) {
    const acc = (data.accounts || []).find(a => a.id === accountId);
    if (!acc) return { startBalance: 0, totalIn: 0, totalOut: 0, currentBalance: 0, periodIn: 0, periodOut: 0, isFiltered: false };

    const startBalance = parseFloat(acc.startBalance) || 0;
    let totalIn = 0, totalOut = 0, periodIn = 0, periodOut = 0;
    const isFiltered = !!(monthFilter || yearFilter);

    for (const bill of (data.bills || [])) {
        if (!bill.paid) continue;
        const isIn  = bill.toAccount   === accountId;
        const isOut = bill.fromAccount === accountId;
        if (!isIn && !isOut) continue;

        const amount = parseFloat(getBillDisplayAmount(bill)) || 0;

        if (isIn)  totalIn  += amount;
        if (isOut) totalOut += amount;

        if (isFiltered) {
            const d = parseLocalDate(getBillDisplayDate(bill));
            const monthMatch = !monthFilter || String(d.getMonth() + 1) === String(monthFilter);
            const yearMatch  = !yearFilter  || String(d.getFullYear())  === String(yearFilter);
            if (monthMatch && yearMatch) {
                if (isIn)  periodIn  += amount;
                if (isOut) periodOut += amount;
            }
        }
    }

    return {
        startBalance,
        totalIn,
        totalOut,
        currentBalance: startBalance + totalIn - totalOut,
        periodIn:  isFiltered ? periodIn  : totalIn,
        periodOut: isFiltered ? periodOut : totalOut,
        isFiltered
    };
}

// ── Running balance start (before a filtered period) ────────

function calcBalanceBeforePeriod(accountId, monthFilter, yearFilter) {
    const acc = (data.accounts || []).find(a => a.id === accountId);
    const startBalance = parseFloat(acc?.startBalance) || 0;
    if (!monthFilter && !yearFilter) return startBalance;

    let running = startBalance;
    for (const bill of (data.bills || [])) {
        if (!bill.paid) continue;
        if (bill.fromAccount !== accountId && bill.toAccount !== accountId) continue;

        const d = parseLocalDate(getBillDisplayDate(bill));
        let before = false;

        if (monthFilter && yearFilter) {
            const filterDate = new Date(parseInt(yearFilter), parseInt(monthFilter) - 1, 1);
            before = d < filterDate;
        } else if (yearFilter) {
            before = d.getFullYear() < parseInt(yearFilter);
        }
        // month-only filter: no "before" concept — start from zero context

        if (before) {
            const amount = parseFloat(getBillDisplayAmount(bill)) || 0;
            if (bill.toAccount   === accountId) running += amount;
            if (bill.fromAccount === accountId) running -= amount;
        }
    }
    return running;
}

// ── Get transactions for one account ────────────────────────

function getAccountTransactions(accountId, monthFilter, yearFilter) {
    return (data.bills || [])
        .filter(bill => {
            if (bill.fromAccount !== accountId && bill.toAccount !== accountId) return false;
            if (!monthFilter && !yearFilter) return true;
            const d = parseLocalDate(getBillDisplayDate(bill));
            const monthMatch = !monthFilter || String(d.getMonth() + 1) === String(monthFilter);
            const yearMatch  = !yearFilter  || String(d.getFullYear())  === String(yearFilter);
            return monthMatch && yearMatch;
        })
        .sort((a, b) => parseLocalDate(getBillDisplayDate(a)) - parseLocalDate(getBillDisplayDate(b)));
}

// ── Render transaction table for one account ─────────────────

function renderAccountTransactions(accountId, monthFilter, yearFilter) {
    const transactions = getAccountTransactions(accountId, monthFilter, yearFilter);

    if (transactions.length === 0) {
        return `<div class="acc-tx-empty">No transactions for this period.</div>`;
    }

    let runningBalance   = calcBalanceBeforePeriod(accountId, monthFilter, yearFilter);
    let projectedBalance = runningBalance;

    const rows = transactions.map(bill => {
        const amount = parseFloat(getBillDisplayAmount(bill)) || 0;
        const isIn  = bill.toAccount   === accountId;
        const isOut = bill.fromAccount === accountId;
        const delta = (isIn && !isOut) ? amount : (!isIn && isOut) ? -amount : 0;

        let displayBalance;
        let isProjected = false;
        if (bill.paid) {
            runningBalance   += delta;
            projectedBalance  = runningBalance;
            displayBalance    = formatMoney(runningBalance);
        } else {
            projectedBalance += delta;
            displayBalance    = formatMoney(projectedBalance);
            isProjected       = true;
        }

        const dateStr    = bill.actualDate || bill.dueDate;
        const displayDate = dateStr ? formatDisplayDate(parseLocalDate(dateStr)) : "—";
        const isPaid     = bill.paid;
        const statusLabel = isPaid ? "Done" : "Planned";

        // Label the other account for transfers
        const otherAccId  = isIn ? bill.fromAccount : bill.toAccount;
        const otherAcc    = otherAccId ? (data.accounts || []).find(a => a.id === otherAccId) : null;
        const otherLabel  = otherAcc ? `${isIn ? "← " : "→ "}${escapeHtml(otherAcc.name)}` : (otherAccId === "external" ? `${isIn ? "← " : "→ "}🌐 External` : "");

        const amountCls   = delta >= 0 ? "acc-tx-in" : "acc-tx-out";
        const balanceCls  = isProjected ? "acc-tx-running--projected"
            : (runningBalance < 0 ? "acc-balance--negative" : "");
        const catColorIdx = bill.category === "Transfers" ? 6
            : bill.category === "Investments" ? 7
            : Math.max(1, (data.categories || []).indexOf(bill.category) + 1);

        return `
        <div class="acc-tx-row ${isPaid ? "acc-tx-paid" : "acc-tx-planned"} category-color-${catColorIdx}${bill.type === "interest" ? " acc-tx-interest" : ""}">
          <div class="acc-tx-date">${displayDate}</div>
          <div class="acc-tx-name">
            <span class="acc-tx-name-main">${bill.type === "interest" ? "✦ " : ""}${escapeHtml(bill.name || bill.category || "—")}</span>
            ${otherLabel ? `<span class="acc-tx-other">${otherLabel}</span>` : ""}
          </div>
          <div class="acc-tx-cat${bill.type === "interest" ? " acc-tx-cat--interest" : ""}">${bill.type === "interest" ? "Interest" : escapeHtml(bill.category || "—")}</div>
          <div class="acc-tx-status ${isPaid ? "acc-status-done" : "acc-status-planned"}">${statusLabel}</div>
          <div class="acc-tx-amount ${amountCls}">
            ${delta >= 0 ? "+" : ""}${formatMoney(delta)}
          </div>
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

// ── Render a single account card ─────────────────────────────

function renderAccountCard(acc, monthFilter, yearFilter) {
    const balance   = calcAccountBalance(acc.id, monthFilter, yearFilter);
    const typeInfo  = (ACC_COL_TYPES || []).find(t => t.type === acc.type) || { emoji: "🏦", label: acc.type };
    const isExpanded = expandedAccountId === acc.id;
    const isNegative = balance.currentBalance < 0;

    const txHtml = isExpanded
        ? renderAccountTransactions(acc.id, monthFilter, yearFilter)
        : "";

    let fundsSectionHtml = "";
    if (acc.type === "savings" && isExpanded && typeof getSvSavedAmount === "function") {
        const linkedFunds = (data.savingsGoals || []).filter(g => !g.archived && g.accountId === acc.id);
        if (linkedFunds.length > 0) {
            fundsSectionHtml = `
            <div class="acc-funds-section">
              <span class="acc-funds-label">Savings Funds in This Account</span>
              ${linkedFunds.map(g => `
              <div class="acc-fund-row">
                <span class="acc-fund-name">${escapeHtml(g.name)}</span>
                <span class="acc-fund-amount">${formatMoney(getSvSavedAmount(g))}</span>
              </div>`).join("")}
            </div>`;
        }
    }

    const borderCls = {
        cash: "acc-page-card--cash", bank: "acc-page-card--bank",
        savings: "acc-page-card--savings", credit: "acc-page-card--credit",
        investment: "acc-page-card--investment"
    }[acc.type] || "";

    const periodLabel = balance.isFiltered ? "Period In" : "Total In";
    const periodOutLabel = balance.isFiltered ? "Period Out" : "Total Out";

    let creditUtilHtml = "";
    if (acc.type === "credit" && acc.creditLimit) {
        const limit = parseFloat(acc.creditLimit) || 0;
        const used  = Math.max(-balance.currentBalance, 0);
        const pct   = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
        const barCls = pct > 75 ? "acc-cc-seg--high" : pct > 40 ? "acc-cc-seg--medium" : "acc-cc-seg--low";
        const available = Math.max(limit - used, 0);
        creditUtilHtml = `
        <div class="acc-cc-utilization">
            <div class="ipb-track">
                <div class="ipb-segments">
                    <div class="ipb-segment ${barCls}" style="width:${pct.toFixed(1)}%;"></div>
                </div>
            </div>
            <div class="acc-cc-util-labels">
                <span class="acc-cc-util-pct">${pct.toFixed(0)}% used</span>
                <span class="acc-cc-util-info">${formatMoney(used)} of ${formatMoney(limit)} &nbsp;·&nbsp; Available: <strong>${formatMoney(available)}</strong></span>
            </div>
        </div>`;
    }

    const editSvg = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5 L16.5 6.5 L7 16 L3 17 L4 13 Z"/><line x1="11" y1="5.5" x2="14.5" y2="9"/></svg>`;
    const chevronSvg = `<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 8 10 13 15 8"/></svg>`;

    return `
    <div class="acc-page-card ${borderCls}" id="acc-card-${acc.id}">
      <div class="acc-page-card-header" onclick="toggleAccountExpand('${acc.id}')">
        <div class="acc-page-card-title">
          <span class="acc-page-emoji">${typeInfo.emoji}</span>
          <span class="acc-page-name">${escapeHtml(acc.name)}</span>
        </div>
        <span class="acc-page-type">${typeInfo.label}</span>
        <div class="acc-page-balance-wrap">
          <span class="acc-page-balance ${isNegative ? "acc-balance--negative" : "acc-balance--positive"}">${formatMoney(balance.currentBalance)}</span>
          <span class="acc-page-balance-label">Current Balance</span>
        </div>
        <div class="dt-debt-ctrls">
          <button class="mini-btn edit-btn app-tooltip-trigger acc-page-edit" onclick="event.stopPropagation();openAccountModal('${acc.id}')">
            ${editSvg}<span class="app-tooltip">Edit</span>
          </button>
          <div class="acc-page-chevron ${isExpanded ? "acc-page-chevron--open" : ""}">
            ${chevronSvg}
          </div>
        </div>
      </div>

      <div class="acc-page-stats">
        <div class="acc-page-stat">
          <span class="acc-page-stat-label">Start Balance</span>
          <span class="acc-page-stat-value">${formatMoney(balance.startBalance)}</span>
        </div>
        <div class="acc-page-stat">
          <span class="acc-page-stat-label">${periodLabel}</span>
          <span class="acc-page-stat-value acc-stat-in">+${formatMoney(balance.periodIn)}</span>
        </div>
        <div class="acc-page-stat">
          <span class="acc-page-stat-label">${periodOutLabel}</span>
          <span class="acc-page-stat-value acc-stat-out">-${formatMoney(balance.periodOut)}</span>
        </div>
        <div class="acc-page-stat">
          <span class="acc-page-stat-label">Net Change</span>
          <span class="acc-page-stat-value ${(balance.periodIn - balance.periodOut) >= 0 ? "acc-balance--positive" : "acc-balance--negative"}">
            ${(balance.periodIn - balance.periodOut) >= 0 ? "+" : ""}${formatMoney(balance.periodIn - balance.periodOut)}
          </span>
        </div>
      </div>

      ${creditUtilHtml}
      <div class="acc-page-transactions" id="acc-tx-${acc.id}" ${isExpanded ? "" : 'style="display:none"'}>
        ${fundsSectionHtml}
        ${txHtml}
      </div>
    </div>`;
}

// ── Main render function ─────────────────────────────────────

function resetAccFilters() {
    localStorage.setItem("ultimatePaycheckAccTypeFilter",  "");
    localStorage.setItem("ultimatePaycheckAccMonthFilter", "");
    localStorage.setItem("ultimatePaycheckAccYearFilter",  "");
    accFiltersLoaded = true;
    const typeSel  = document.getElementById("accFilterType");
    const monthSel = document.getElementById("accFilterMonth");
    const yearSel  = document.getElementById("accFilterYear");
    if (typeSel)  typeSel.value  = "";
    if (monthSel) monthSel.value = "";
    if (yearSel)  yearSel.value  = "";
    renderAccountsPage();
}

function updateAccAllPill() {
    const typeFilter  = document.getElementById("accFilterType")?.value  ?? "";
    const monthFilter = document.getElementById("accFilterMonth")?.value ?? "";
    const yearFilter  = document.getElementById("accFilterYear")?.value  ?? "";
    const allBtn = document.getElementById("accFilterAll");
    if (allBtn) allBtn.classList.toggle("active", !typeFilter && !monthFilter && !yearFilter);
}

function renderAccountsPage() {
    const el = document.getElementById("accountsPageGrid");
    if (!el) return;

    populateAccFilterSelects();

    const monthFilter = document.getElementById("accFilterMonth")?.value ?? "";
    const yearFilter  = document.getElementById("accFilterYear")?.value  ?? "";
    const typeFilter  = document.getElementById("accFilterType")?.value  ?? "";
    localStorage.setItem("ultimatePaycheckAccTypeFilter",  typeFilter);
    localStorage.setItem("ultimatePaycheckAccMonthFilter", monthFilter);
    localStorage.setItem("ultimatePaycheckAccYearFilter",  yearFilter);

    const accounts = (data.accounts || [])
        .filter(acc => !typeFilter || acc.type === typeFilter)
        .sort((a, b) => {
            const ai = (ACC_COL_TYPES || []).findIndex(t => t.type === a.type);
            const bi = (ACC_COL_TYPES || []).findIndex(t => t.type === b.type);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

    updateAccAllPill();

    if (accounts.length === 0) {
        el.innerHTML = `
        <div class="acc-page-empty">
          <div class="acc-page-empty-icon">🏦</div>
          <p>No accounts yet.</p>
          <p>Add your bank accounts, credit cards, and cash in <button class="acc-link-btn" onclick="showSection('settings')">Settings → Bank Accounts</button>.</p>
        </div>`;
        return;
    }

    el.innerHTML = accounts.map(acc => renderAccountCard(acc, monthFilter, yearFilter)).join("");
    if (typeof renderAccountsSummaryCards === "function") renderAccountsSummaryCards();
}

// ── Toggle expand ────────────────────────────────────────────

function toggleAccountExpand(accountId) {
    expandedAccountId = (expandedAccountId === accountId) ? null : accountId;
    renderAccountsPage();

    if (expandedAccountId) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const table     = document.querySelector(`#acc-card-${expandedAccountId} .acc-tx-table`);
            if (!table) return;
            const firstPaid = table.querySelector(".acc-tx-paid");
            if (!firstPaid) return;
            const rowH        = firstPaid.offsetHeight || 36;
            const tableTop    = table.getBoundingClientRect().top;
            const paidTop     = firstPaid.getBoundingClientRect().top;
            const contentPos  = (paidTop - tableTop) + table.scrollTop;
            table.scrollTop   = Math.max(0, contentPos - rowH * 3);
        }));
    }
}

function openAccountsInfoModal() {
    if (localStorage.getItem("ultimatePaycheckAccountsSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("accountsInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeAccountsInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckAccountsSeen", "true");
    document.getElementById("accountsInfoModal").classList.remove("active");
}

window.closeAccountsInfoModal = closeAccountsInfoModal;
window.renderAccountsPage   = renderAccountsPage;
window.toggleAccountExpand  = toggleAccountExpand;
window.resetAccFilters      = resetAccFilters;