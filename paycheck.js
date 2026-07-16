// ============================================================
// EZ Paycheck Budget — paycheck.js
// ============================================================

function renderPaycheck() {
    const el = document.getElementById("paycheckBreakdown");
    if (!el) return;

    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();
    const pc = pcs[idx];

    const catColors = [
        { main: "#77dddb", shades: ["#4ecece", "#77dddb", "#9de8e7", "#b8efee", "#cdf4f3", "#dff8f8"], soft: "var(--mint-soft-2)", soft3: "var(--mint-soft-3)", tableBg: "rgba(116, 255, 253, 0.06)", text: "var(--mint-text)", border: "#9ce4e3", inputColor: "var(--mint-dark, #025e5e)" },
        { main: "#d299dc", shades: ["#c285d0", "#d299dc", "#ddb0e8", "#eaccf2", "#f5e5f9", "#faf0fc"], soft: "var(--purple-soft-2)", soft3: "var(--purple-soft-3)", tableBg: "rgba(210,153,220,0.06)", text: "var(--purple-text)", border: "#ddb0e8", inputColor: "var(--purple-text)" },
        { main: "#ffcf5f", shades: ["#f0b830", "#ffcf5f", "#ffe08a", "#ffedb3", "#fff7d9", "#fffdf0"], soft: "var(--yellow-soft-2)", soft3: "var(--yellow-soft-3)", tableBg: "rgba(255,207,95,0.06)", text: "var(--yellow-text)", border: "#ffe08a", inputColor: "var(--yellow-text)" },
        { main: "#fea969", shades: ["#f08848", "#fea969", "#ffc090", "#ffd4b5", "#ffeada", "#fff5ee"], soft: "var(--orange-soft-2)", soft3: "var(--orange-soft-3)", tableBg: "rgba(254,169,105,0.06)", text: "var(--orange-text)", border: "#ffd0a0", inputColor: "var(--orange-text)" },
        { main: "#fe7aa7", shades: ["#f06090", "#fe7aa7", "#ffaac8", "#ffcbde", "#ffe5ef", "#fff5f8"], soft: "var(--pink-soft-2)", soft3: "var(--pink-soft-3)", tableBg: "rgba(254,122,167,0.06)", text: "var(--pink-text)", border: "#ffb0cc", inputColor: "var(--pink-text)" }
    ];

    if (!pc) {
        const month = new Date().getMonth();
        const year = new Date().getFullYear();
        const _mk = "empty";
        el.className = "mi-cat-grid";
        el.innerHTML = renderSummaryCard(catColors, [], month, year, _mk) + data.categories.map((cat, idx) => {
            const color = catColors[idx % catColors.length];
            return renderCategoryCard(cat, color, [], month, year, 0, _mk, idx);
        }).join("");
        applyPaycheckTextOverrides(el, null);
        return;
    }

    const start = parseLocalDate(pc.startDate);
    const end = parseLocalDate(pc.endDate);
    const monthBills = data.bills.filter(bill => {
        const d = parseLocalDate(getBillDisplayDate(bill));
        return d >= start && d <= end;
    });

    const month = start.getMonth();
    const year = start.getFullYear();
    const _mk = pc.id;
    const _mb = data.paycheckBudgets?.[_mk] || {};
    const totalBudget = parseFloat(_mb.total || 0);
    const catSum = Object.values(_mb.categories || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const overdraftAmount = totalBudget > 0 && catSum > totalBudget ? catSum - totalBudget : 0;

    el.className = "mi-cat-grid";
    el.innerHTML = renderSummaryCard(catColors, monthBills, month, year, _mk, start) + data.categories.map((cat, idx) => {
        const color = catColors[idx % catColors.length];
        return renderCategoryCard(cat, color, monthBills, month, year, overdraftAmount, _mk, idx);
    }).join("");

    // Rewire inputuri budget → paycheckBudgets
    el.querySelectorAll(".mi-budget-input[data-cat]").forEach(input => {
        input.dataset.mk = pc.id;
        input.oninput = null;
        input.onblur = null;
        input.setAttribute("oninput", "savePaycheckCategoryBudget(this)");
        input.setAttribute("onblur", "savePaycheckCategoryBudgetOnBlur(this)");
    });
    applyPaycheckTextOverrides(el, parseLocalDate(pc.startDate));
}

function applyPaycheckTextOverrides(el, startDate) {
    const summaryHeader = el.querySelector(".mi-cat-card:first-child .mi-cat-header-name");
    if (summaryHeader) summaryHeader.textContent = "PAYCHECK BREAKDOWN";

    const rolloverLabel = el.querySelector(".mi-cat-card:first-child .mi-budget-label");
    if (rolloverLabel) {
        const _rolloverCats = new Set([...(data.categories || []), "Investments"]);
        const hasPrior = startDate && (data.bills || []).some(b => b.paid && _rolloverCats.has(b.category) && parseLocalDate(getBillDisplayDate(b)) < startDate);
        const helpIcon = rolloverLabel.querySelector(".help-icon");
        if (helpIcon) {
            if (hasPrior) {
                helpIcon.dataset.helpTitle = "Rollover — How it works";
                helpIcon.dataset.help = "Amount carried over from before this paycheck, calculated automatically from your paid transactions.";
            } else {
                helpIcon.dataset.helpTitle = "Starting Balance — How it works";
                helpIcon.dataset.help = "The sum of your bank and cash account start balances — the money you had available before any transactions were recorded.";
            }
        }
        rolloverLabel.childNodes.forEach(n => { if (n.nodeType === 3) n.remove(); });
        rolloverLabel.appendChild(document.createTextNode(hasPrior ? "Rollover" : "Starting Balance"));
    }

    el.querySelectorAll(".mi-cat-card").forEach(card => {
        const budgetLabel = card.querySelector(".mi-budget-label");
        if (budgetLabel) {
            const helpIcon = budgetLabel.querySelector(".help-icon");
            if (helpIcon) {
                if (helpIcon.dataset.helpTitle === "Expected Income — How it works") {
                    helpIcon.dataset.help = helpIcon.dataset.help.replace("for this month", "for this paycheck");
                } else if (helpIcon.dataset.helpTitle === "Savings Goal — How it works") {
                    helpIcon.dataset.help = helpIcon.dataset.help.replace("for this month", "for this paycheck");
                } else if (helpIcon.dataset.helpTitle === "Monthly Budget — How it works") {
                    helpIcon.dataset.helpTitle = "Paycheck Budget — How it works";
                    helpIcon.dataset.help = "Set a paycheck budget for this category to track your spending.<br><br>The progress bar shows how much of your budget has been allocated (actual) and how much has already been paid.";
                    budgetLabel.childNodes.forEach(n => { if (n.nodeType === 3) n.remove(); });
                    budgetLabel.appendChild(document.createTextNode("Paycheck Budget"));
                }
            }
        }

        card.querySelectorAll("td").forEach(td => {
            if (td.textContent.includes("this month")) td.textContent = td.textContent.replace("this month", "this paycheck");
        });

        card.querySelectorAll(".mi-pill-val").forEach(pill => {
            if (pill.textContent.includes("this month")) pill.textContent = pill.textContent.replace("this month", "this paycheck");
        });

        const shortMonths = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        card.querySelectorAll(".mi-donut-svg text").forEach(t => {
            if (shortMonths.includes(t.textContent.trim())) {
                t.textContent = "";
                const sibling = t.nextElementSibling;
                if (sibling && sibling.tagName === "text") {
                    sibling.setAttribute("y", "95");
                    sibling.setAttribute("font-size", "12");
                }
            }
        });

        card.querySelectorAll(".mi-donut-legend span").forEach(span => {
            if (span.textContent.includes("this month")) span.textContent = span.textContent.replace("this month", "this paycheck");
        });
    });
}

function updatePaycheckPageTitle() {
    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();
    const pc = pcs[idx];

    const titleEl = document.getElementById("pageTitle");
    if (!titleEl) return;

    if (!pc) {
        if (!titleEl.classList.contains("page-paycheck")) return;
        titleEl.className = "rainbow-title page-paycheck";
        titleEl.innerHTML = "add paycheck".split("").map(l => l === " " ? " " : `<span>${l}</span>`).join("");
        const caret = document.createElement("span");
        caret.className = "title-month-caret";
        caret.innerHTML = `<svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg"><path d="M1 1.5L6 6.5L11 1.5" stroke="#bbb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
        titleEl.appendChild(caret);
        titleEl.style.cursor = "pointer";
        titleEl.onclick = (e) => { e.stopPropagation(); openNewPaycheckModal(); };
        document.querySelectorAll(".paycheck-interval").forEach(el => el.remove());
        return;
    }

    const interval = formatPaycheckInterval(pc.startDate, pc.endDate);

    titleEl.className = "rainbow-title page-paycheck";
    titleEl.innerHTML = pc.name.split("").map(l => l === " " ? " " : `<span>${l}</span>`).join("");

    const caret = document.createElement("span");
    caret.className = "title-month-caret";
    caret.innerHTML = `<svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg"><path d="M1 1.5L6 6.5L11 1.5" stroke="#bbb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    titleEl.appendChild(caret);

    document.querySelectorAll(".paycheck-interval").forEach(el => el.remove());
    const intervalEl = document.createElement("div");
    intervalEl.className = "paycheck-interval";
    intervalEl.textContent = interval;
    titleEl.parentNode.insertBefore(intervalEl, titleEl.nextSibling);

    titleEl.style.cursor = "pointer";
    titleEl.onclick = (e) => { e.stopPropagation(); togglePaycheckDropdown(); };
}

 function togglePaycheckDropdown() {
    const existing = document.getElementById("paycheckTitleDropdown");
    if (existing) { existing.remove(); return; }

    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();

    const dd = document.createElement("div");
    dd.id = "paycheckTitleDropdown";
    dd.className = "paycheck-dropdown";

    const freq = data.paycheckSettings?.frequency || "custom";
    if (freq === "custom") {
        const addDiv = document.createElement("div");
        addDiv.className = "csd-option paycheck-new-btn";
        addDiv.style.cssText = "color:var(--mint-text); font-weight:600;";
        addDiv.textContent = "+ New Paycheck";
        addDiv.onclick = (e) => { e.stopPropagation(); dd.remove(); openNewPaycheckModal(); };
        dd.appendChild(addDiv);

        const sep = document.createElement("div");
        sep.style.cssText = "height:0.5px; background:var(--line); margin:4px 0;";
        dd.appendChild(sep);
    }

    const sorted = [...pcs]
        .map((pc, i) => ({ pc, i }))
        .sort((a, b) => parseLocalDate(b.pc.startDate) - parseLocalDate(a.pc.startDate));

    sorted.forEach(({ pc: sortedPc, i: realIdx }) => {
        const div = document.createElement("div");
        div.className = "csd-option" + (realIdx === idx ? " csd-selected" : "");
        div.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px; white-space:nowrap;";

        const label = document.createElement("span");
        label.textContent = sortedPc.name + " · " + formatPaycheckInterval(sortedPc.startDate, sortedPc.endDate);
        label.onclick = (e) => { e.stopPropagation(); setCurrentPaycheckIndex(realIdx); dd.remove(); renderAllPaycheck(); };
        div.appendChild(label);

        const editBtn = document.createElement("button");
        editBtn.className = "paycheck-dropdown-edit-btn";
        editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5 L16.5 6.5 L7 16 L3 17 L4 13 Z"/><line x1="11" y1="5.5" x2="14.5" y2="9"/></svg>`;
        editBtn.onclick = (e) => { e.stopPropagation(); setCurrentPaycheckIndex(realIdx); dd.remove(); openEditPaycheckModal(); };
        div.appendChild(editBtn);

        dd.appendChild(div);
    });

    const titleEl = document.getElementById("pageTitle");
    const rect = titleEl.getBoundingClientRect();
    if (window.innerWidth <= 700) {
        const ddWidth = 320;
        const centeredLeft = (window.innerWidth - ddWidth) / 2;
        dd.style.cssText += `position:fixed; top:${rect.bottom + 8}px; left:${centeredLeft}px; width:${ddWidth}px; max-width:90vw; z-index:999;`;
    } else {
        dd.style.cssText += `position:fixed; top:${rect.bottom + 8}px; left:${rect.left}px; z-index:999;`;
    }
    document.body.appendChild(dd);
    setTimeout(() => {
        const selected = dd.querySelector(".csd-option.csd-selected");
        if (selected) selected.scrollIntoView({ block: "center" });
        document.addEventListener("click", () => dd.remove(), { once: true });
    }, 0);
    window.addEventListener("scroll", (e) => {
        if (!dd.contains(e.target)) dd.remove();
    }, { once: true, capture: true });
}

function renderPaycheckNav() {
    const navEl = document.getElementById("paycheckNav");
    if (!navEl) return;

    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();

    if (!pcs.length) {
        navEl.innerHTML = `
            <div class="filters-left"></div>
            <button class="btn add-bill-btn" onclick="openNewPaycheckModal()">+ New Paycheck</button>
        `;
        return;
    }

    navEl.innerHTML = `
        <div class="filters-left" style="gap:8px;">
            <button class="filter-pill" onclick="navigatePaycheck(-1)" ${idx === 0 ? "disabled style='opacity:0.4;cursor:default;'" : ""}>‹ Prev</button>
            <button class="filter-pill" onclick="navigatePaycheck(1)" ${idx === pcs.length - 1 ? "disabled style='opacity:0.4;cursor:default;'" : ""}>Next ›</button>
            <button class="btn soft" onclick="openEditPaycheckModal()" style="padding:5px 12px; font-size:13px;">✏️ Edit</button>
        </div>
        <button class="btn add-bill-btn" onclick="openNewPaycheckModal()">+ New Paycheck</button>
    `;
}

function navigatePaycheck(dir) {
    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();
    const newIdx = Math.max(0, Math.min(pcs.length - 1, idx + dir));
    setCurrentPaycheckIndex(newIdx);
    renderAllPaycheck();
}

function renderPaycheckNotes() {
    const el = document.getElementById("paycheckNotes");
    if (!el) return;
    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();
    const pc = pcs[idx];
    if (!pc) { el.innerHTML = ""; return; }
    const key = `notes_paycheck_${pc.id}`;
    const saved = data.monthlyNotes?.[key] || "";
    el.innerHTML = `
        <div class="monthly-notes-sticky">
            <div class="monthly-notes-pin">📌</div>
            <div class="monthly-notes-title">Paycheck notes · ${pc.name}</div>
            <div class="monthly-notes-line">
                <textarea class="monthly-notes-textarea" oninput="savePaycheckNote(this, '${key}')">${saved}</textarea>
            </div>
        </div>`;
    const ta = el.querySelector("textarea");
    if (ta) setTimeout(() => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }, 0);
}

let _paycheckNoteTimer = null;
function savePaycheckNote(textarea, key) {
    if (!data.monthlyNotes) data.monthlyNotes = {};
    data.monthlyNotes[key] = textarea.value;
    clearTimeout(_paycheckNoteTimer);
    _paycheckNoteTimer = setTimeout(() => saveData(), 1000);
}

 function renderPaycheckHeader() {
    const pageHeader = document.getElementById("pageHeader");
    const summaryGrid = document.getElementById("summaryGrid");
    if (!pageHeader || !summaryGrid) return;

    pageHeader.style.display = "";
    document.querySelector("main")?.classList.remove("no-header");
    summaryGrid.style.display = "";

    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();
    const pc = pcs[idx];

    if (!pc) {
        const catColors = ["var(--mint-text)", "var(--purple-text)", "var(--yellow-text)", "var(--orange-text)", "var(--pink-text)"];
        const cards = data.categories.map((cat, i) => `
            <div class="summary-card" data-stat="cat-${i + 1}">
                <div class="label">${cat}</div>
                <div class="value" style="color:${catColors[i] || "var(--text)"}">${formatMoney(0)}</div>
            </div>`).join("");
        summaryGrid.innerHTML = cards;

        const existingIpb = document.getElementById("insightsProgressBar");
        if (existingIpb) existingIpb.remove();
        document.querySelector(".summary-grid-top")?.classList.remove("has-progress-bar");

        const ipb = document.createElement("div");
        ipb.id = "insightsProgressBar";
        ipb.className = "insights-progress-bar visible";
        ipb.innerHTML = `
            <div class="ipb-track"><div class="ipb-segments"><div style="width:100%;height:100%;background:var(--bar-bg);"></div></div></div>
            <div class="ipb-labels-row" style="display:flex;justify-content:space-between;width:100%;margin-top:3px;gap:8px;"></div>`;
        document.querySelector(".summary-grid-wrap")?.appendChild(ipb);
        document.querySelector(".summary-grid-top")?.classList.add("has-progress-bar");
        return;
    }

    const start = parseLocalDate(pc.startDate);
    const end = parseLocalDate(pc.endDate);
    const month = start.getMonth();
    const year = start.getFullYear();
    const paycheckBills = data.bills.filter(bill => {
        const date = parseLocalDate(getBillDisplayDate(bill));
        return date >= start && date <= end;
    });
    const catColors = ["var(--mint-text)", "var(--purple-text)", "var(--yellow-text)", "var(--orange-text)", "var(--pink-text)"];
    const cards = data.categories.map((cat, i) => {
        const catBills = paycheckBills.filter(b => b.category === cat && b.paid);
        const total = sum(catBills);
        return `<div class="summary-card" data-stat="cat-${i + 1}">
            <div class="label">${cat}</div>
            <div class="value" style="color:${catColors[i] || "var(--text)"}">${formatMoney(total)}</div>
        </div>`;
    }).join("");
    summaryGrid.innerHTML = cards;

    const _mk = pc.id;
    const rollover = typeof calcAutoRollover === "function" ? calcAutoRollover(parseLocalDate(pc.startDate)) : 0;
    const spendingCats = data.categories.slice(2);
    const segBarColors = ["var(--yellow)", "var(--orange)", "var(--pink)", "var(--pink)"];

    const incomeRec = paycheckBills.filter(b => b.category === data.categories[0] && b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
    const savingsRec = paycheckBills.filter(b => b.category === data.categories[1] && b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
    const cashSpent = paycheckBills.filter(b => spendingCats.includes(b.category) && b.paid && !isFromCreditAccount(b)).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
    const investmentsRec = paycheckBills.filter(b => b.category === "Investments" && b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
    const totalBase = rollover + incomeRec;
    const amountLeft = totalBase - savingsRec - cashSpent - investmentsRec;
     

    const spendingSegs = spendingCats.map((cat, i) => ({
        color: segBarColors[i] || "var(--peach)",
        amount: paycheckBills.filter(b => b.category === cat && b.paid && !isFromCreditAccount(b)).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0)
    }));

    const allSegs = [
        { color: "var(--mint)", amount: Math.max(amountLeft, 0) },
        { color: "var(--purple)", amount: savingsRec },
        ...spendingSegs
    ].filter(s => s.amount > 0);

    const segHtml = totalBase > 0
        ? allSegs.map(s => `<div class="ipb-segment" style="width:${Math.min((s.amount / totalBase) * 100, 100).toFixed(1)}%;background:${s.color};"></div>`).join("")
        : "";

    const existingIpb = document.getElementById("insightsProgressBar");
    if (existingIpb) existingIpb.remove();
    document.querySelector(".summary-grid-top")?.classList.remove("has-progress-bar");

    const ipb = document.createElement("div");
    ipb.id = "insightsProgressBar";
    ipb.className = "insights-progress-bar visible";
    const segTextColors = ["var(--yellow-text)", "var(--orange-text)", "var(--pink-text)", "var(--pink-text)"];
    const labelSegs = [
        { color: "var(--purple-text)", label: data.categories[1], amount: savingsRec },
        ...spendingCats.map((cat, i) => ({ color: segTextColors[i] || "var(--text)", label: cat, amount: spendingSegs[i].amount })),
        { color: "var(--mint-text)", label: "left to spend", amount: Math.max(amountLeft, 0) }
    ].filter(s => s.amount > 0);

    const rightLabels = labelSegs.filter(s => s.label !== "left to spend")
        .map(s => `<span style="color:${s.color};font-size:10px;white-space:nowrap;">${s.label === "Debt Payments" ? "Debts" : s.label} <strong>${formatMoney(s.amount)}</strong></span>`)
        .join("&nbsp;&nbsp;&nbsp;");
    const leftLabel = labelSegs.find(s => s.label === "left to spend");
    const leftHtml = leftLabel ? `<span style="color:var(--mint-text);font-size:12px;white-space:nowrap;"><span class="help-icon" data-help-title="Left to Spend — How it works" data-help="This is the amount of cash available after receiving income, setting aside savings, investing, and paying cash/debit expenses.&lt;br&gt;&lt;br&gt;Any payment made with a &lt;strong&gt;credit card&lt;/strong&gt; is &lt;strong&gt;not deducted&lt;/strong&gt; from this amount — it appears in your category totals but doesn't affect your available cash.&lt;br&gt;&lt;br&gt;Formula: Rollover + Income received − Savings − Investments − Cash expenses" style="cursor:pointer;margin-right:4px;">📊</span>Left to spend <strong>${formatMoney(leftLabel.amount)}</strong></span>` : "";

    ipb.innerHTML = `
        <div class="ipb-track"><div class="ipb-segments">${segHtml || '<div style="width:100%;height:100%;background:var(--bar-bg);"></div>'}</div></div>
        <div class="ipb-labels-row" style="display:flex;justify-content:space-between;width:100%;margin-top:3px;gap:8px;">
            ${leftHtml}<span class="ipb-right-labels">${rightLabels}</span>
        </div>`;
    document.querySelector(".summary-grid-wrap")?.appendChild(ipb);
    document.querySelector(".summary-grid-top")?.classList.add("has-progress-bar");
}

// ── Helpers ──────────────────────────────────────────────────

function getPaychecks() {
    if (!data.paychecks) data.paychecks = [];
    return data.paychecks;
}

function getCurrentPaycheckIndex() {
    const pcs = getPaychecks();
    if (!pcs.length) return -1;
    const saved = localStorage.getItem("ezPaycheckActiveIndex");
    if (saved === null) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIdx = pcs.findIndex(pc => {
            const start = parseLocalDate(pc.startDate);
            const end = parseLocalDate(pc.endDate);
            return today >= start && today <= end;
        });
        if (todayIdx !== -1) return todayIdx;
        const today2 = new Date(); today2.setHours(0, 0, 0, 0);
        const nextIdx = pcs.findIndex(pc => parseLocalDate(pc.startDate) > today2);
        return nextIdx !== -1 ? nextIdx : pcs.length - 1;
    }
    const idx = parseInt(saved);
    return Math.min(Math.max(idx, 0), pcs.length - 1);
}

function setCurrentPaycheckIndex(idx) {
    localStorage.setItem("ezPaycheckActiveIndex", idx);
}

function formatPaycheckInterval(startDate, endDate) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const s = parseLocalDate(startDate);
    const e = parseLocalDate(endDate);
    if (s.getFullYear() === e.getFullYear()) {
        return `${s.getDate()} ${months[s.getMonth()]} – ${e.getDate()} ${months[e.getMonth()]} ${e.getFullYear()}`;
    }
    return `${s.getDate()} ${months[s.getMonth()]} ${s.getFullYear()} – ${e.getDate()} ${months[e.getMonth()]} ${e.getFullYear()}`;
}

function getPaycheckBills(pc) {
    if (!pc) return [];
    const start = parseLocalDate(pc.startDate);
    const end = parseLocalDate(pc.endDate);
    return data.bills.filter(bill => {
        const d = parseLocalDate(getBillDisplayDate(bill));
        return d >= start && d <= end;
    });
}

let _paycheckInitialized = false;
function resetPaycheckInitialized() { _paycheckInitialized = false; }
window.resetPaycheckInitialized = resetPaycheckInitialized;

function renderAllPaycheck() {
    if (!_paycheckInitialized) {
        _paycheckInitialized = true;
        const pcs = getPaychecks();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIdx = pcs.findIndex(pc => {
            const start = parseLocalDate(pc.startDate);
            const end = parseLocalDate(pc.endDate);
            return today >= start && today <= end;
        });
        if (todayIdx !== -1) setCurrentPaycheckIndex(todayIdx);
        else {
            const nextIdx = pcs.findIndex(pc => parseLocalDate(pc.startDate) > today);
            setCurrentPaycheckIndex(nextIdx !== -1 ? nextIdx : pcs.length - 1);
        }
    }

    updatePaycheckPageTitle();
    renderPaycheckNav();
    renderPaycheckHeader();
    renderPaycheck();
    renderPaycheckNotes();
    if (typeof updatePaycheckSetupVisibility === "function") updatePaycheckSetupVisibility();
}

function openNewPaycheckModal() {
    const freq = data.paycheckSettings?.frequency || "custom";
    if (freq !== "custom") {
        if (!confirm("You're using auto-generated paychecks. You can still add a manual paycheck — for example, to fill a gap or add an extra pay period.\n\nContinue?")) return;
    }
    const pcs = getPaychecks();
    let suggestedStart = "";
    if (pcs.length) {
        const last = pcs[pcs.length - 1];
        const nextDay = parseLocalDate(last.endDate);
        nextDay.setDate(nextDay.getDate() + 1);
        suggestedStart = toLocalDateInputValue(nextDay);
    }
    document.getElementById("paycheckModalTitle").textContent = "📋 New Paycheck";
    document.getElementById("paycheckModalName").value = "";
    document.getElementById("paycheckModalName").placeholder = "Add paycheck name";
    document.getElementById("paycheckModalStart").value = suggestedStart;
    document.getElementById("paycheckModalStart").classList.toggle("has-value", !!suggestedStart);
    document.getElementById("paycheckModalEnd").value = "";
    document.getElementById("paycheckModalEnd").classList.remove("has-value");
    document.getElementById("paycheckModalDeleteBtn").style.display = "none";
    document.getElementById("paycheckModalDeleteFollowingBtn").style.display = "none";
    document.getElementById("paycheckModalSaveBtn").onclick = saveNewPaycheck;
    document.getElementById("paycheckModal").classList.add("active");
}

function openEditPaycheckModal() {
    const pcs = getPaychecks();
    const idx = getCurrentPaycheckIndex();
    const pc = pcs[idx];
    if (!pc) return;
    const isAuto = (data.paycheckSettings?.frequency || "custom") !== "custom";

    document.getElementById("paycheckModalTitle").textContent = "✏️ Edit Paycheck";
    document.getElementById("paycheckModalName").value = pc.name;

    const startWrap = document.getElementById("paycheckModalStart").closest("div") || document.getElementById("paycheckModalStart").parentElement;
    const endWrap = document.getElementById("paycheckModalEnd").closest("div") || document.getElementById("paycheckModalEnd").parentElement;
    const datesSection = document.querySelector(".paycheck-modal-dates");

    if (datesSection) datesSection.style.display = "";

    document.getElementById("paycheckModalStart").value = pc.startDate;
    document.getElementById("paycheckModalStart").classList.toggle("has-value", !!pc.startDate);
    document.getElementById("paycheckModalEnd").value = pc.endDate;
    document.getElementById("paycheckModalEnd").classList.toggle("has-value", !!pc.endDate);
    document.getElementById("paycheckModalDeleteBtn").style.display = "";
    document.getElementById("paycheckModalDeleteFollowingBtn").style.display = "";
    document.getElementById("paycheckModalSaveBtn").onclick = saveEditPaycheck;
    document.getElementById("paycheckModal").classList.add("active");
}

function saveNewPaycheck() {
    const name = document.getElementById("paycheckModalName").value.trim();
    const startDate = document.getElementById("paycheckModalStart").value;
    const endDate = document.getElementById("paycheckModalEnd").value;
    if (!name || !startDate || !endDate) return;
    if (!data.paychecks) data.paychecks = [];
    data.paychecks.push({ id: crypto.randomUUID(), name, startDate, endDate });
    setCurrentPaycheckIndex(data.paychecks.length - 1);
    saveData();
    closePaycheckModal();
    renderAllPaycheck();
}

function saveEditPaycheck() {
    const name = document.getElementById("paycheckModalName").value.trim();
    if (!name) return;
    const idx = getCurrentPaycheckIndex();
    const startDate = document.getElementById("paycheckModalStart").value;
    const endDate = document.getElementById("paycheckModalEnd").value;
    if (!startDate || !endDate) return;
    data.paychecks[idx] = { ...data.paychecks[idx], name, startDate, endDate };
    saveData();

    const start = parseLocalDate(startDate);
    const end = parseLocalDate(endDate);
    const warnings = [];

    data.paychecks.forEach((pc, i) => {
        if (i === idx) return;
        const pcStart = parseLocalDate(pc.startDate);
        const pcEnd = parseLocalDate(pc.endDate);
        if (start <= pcEnd && end >= pcStart) {
            const overlapStart = start > pcStart ? startDate : pc.startDate;
            const overlapEnd = end < pcEnd ? endDate : pc.endDate;
            warnings.push(`⚠️ Overlap with "${pc.name}" (${pc.startDate} – ${pc.endDate}).\n\nTransactions between ${overlapStart} and ${overlapEnd} will appear in both paychecks. To fix this, adjust the end date of one or the start date of the other.`);
        }
    });

    const sorted = [...data.paychecks].sort((a, b) => parseLocalDate(a.startDate) - parseLocalDate(b.startDate));
    const sortedIdx = sorted.findIndex(pc => pc.startDate === startDate && pc.endDate === endDate);
    if (sortedIdx > 0) {
        const prev = sorted[sortedIdx - 1];
        const prevEnd = parseLocalDate(prev.endDate);
        const expectedStart = new Date(prevEnd);
        expectedStart.setDate(expectedStart.getDate() + 1);
        if (start > expectedStart) {
            warnings.push(`⚠️ Gap detected after "${prev.name}" (ends ${prev.endDate}). Transactions between ${prev.endDate} and ${startDate} won't belong to any paycheck.`);
        }
    }
    if (sortedIdx < sorted.length - 1) {
        const next = sorted[sortedIdx + 1];
        const nextStart = parseLocalDate(next.startDate);
        const expectedEnd = new Date(nextStart);
        expectedEnd.setDate(expectedEnd.getDate() - 1);
        if (end < expectedEnd) {
            warnings.push(`⚠️ Gap detected before "${next.name}" (starts ${next.startDate}). Transactions between ${endDate} and ${next.startDate} won't belong to any paycheck.`);
        }
    }

    if (warnings.length > 0) {
        alert(warnings.join("\n\n"));
    }

    closePaycheckModal();
    renderAllPaycheck();
}

function deletePaycheck() {
    if (!confirm("Delete this paycheck? Transactions are not affected.")) return;
    const idx = getCurrentPaycheckIndex();
    const id = data.paychecks[idx].id;
    if (data.paycheckBudgets?.[id]) delete data.paycheckBudgets[id];
    if (data.monthlyNotes?.[`notes_paycheck_${id}`]) delete data.monthlyNotes[`notes_paycheck_${id}`];
    data.paychecks.splice(idx, 1);
    setCurrentPaycheckIndex(Math.max(0, idx - 1));
    saveData();
    closePaycheckModal();
    renderAllPaycheck();
}

function deleteThisAndFollowing() {
    const idx = getCurrentPaycheckIndex();
    const count = data.paychecks.length - idx;
    if (!confirm(`Delete this paycheck and the ${count - 1} following? Transactions are not affected.`)) return;
    const removed = data.paychecks.splice(idx);
    removed.forEach(pc => {
        if (data.paycheckBudgets?.[pc.id]) delete data.paycheckBudgets[pc.id];
        if (data.monthlyNotes?.[`notes_paycheck_${pc.id}`]) delete data.monthlyNotes[`notes_paycheck_${pc.id}`];
    });
    setCurrentPaycheckIndex(Math.max(0, idx - 1));
    saveData();
    closePaycheckModal();
    renderAllPaycheck();
}

function deleteAllPaychecks() {
    if (!confirm("Delete all paychecks? Transactions are not affected.")) return;
    (data.paychecks || []).forEach(pc => {
        if (data.paycheckBudgets?.[pc.id]) delete data.paycheckBudgets[pc.id];
        if (data.monthlyNotes?.[`notes_paycheck_${pc.id}`]) delete data.monthlyNotes[`notes_paycheck_${pc.id}`];
    });
    data.paychecks = [];
    data.paycheckSettings.startDate = "";
    const startDateEl = document.getElementById("paycheckStartDate");
    if (startDateEl) { startDateEl.value = ""; startDateEl.type = "text"; startDateEl.type = "date"; }
    setCurrentPaycheckIndex(0);
    saveData();
    closePaycheckModal();
    const deleteAllBtn = document.getElementById("deleteAllPaychecksBtn");
    if (deleteAllBtn) deleteAllBtn.style.display = "none";
    renderAllPaycheck();
}

function closePaycheckModal() {
    document.getElementById("paycheckModal").classList.remove("active");
}

function savePaycheckCategoryBudget(input) {
    const cat = input.dataset.cat;
    const mk = input.dataset.mk;
    if (!cat || !mk) return;
    const isEmpty = input.value.trim() === "";
    const val = parseFloat(input.value) || 0;
    if (!data.paycheckBudgets) data.paycheckBudgets = {};
    if (!data.paycheckBudgets[mk]) data.paycheckBudgets[mk] = {};
    if (!data.paycheckBudgets[mk].categories) data.paycheckBudgets[mk].categories = {};
    if (isEmpty || val === 0) {
        delete data.paycheckBudgets[mk].categories[cat];
    } else {
        data.paycheckBudgets[mk].categories[cat] = val;
    }
    clearTimeout(_paycheckBudgetSaveTimer);
    _paycheckBudgetSaveTimer = setTimeout(() => saveData(), 800);
}

function savePaycheckCategoryBudgetOnBlur(input) {
    clearTimeout(_paycheckBudgetSaveTimer);
    const cat = input.dataset.cat;
    const mk = input.dataset.mk;
    if (!cat || !mk) return;
    const isEmpty = input.value.trim() === "";
    const val = parseFloat(input.value) || 0;
    if (!data.paycheckBudgets) data.paycheckBudgets = {};
    if (!data.paycheckBudgets[mk]) data.paycheckBudgets[mk] = {};
    if (!data.paycheckBudgets[mk].categories) data.paycheckBudgets[mk].categories = {};
    if (isEmpty || val === 0) {
        delete data.paycheckBudgets[mk].categories[cat];
    } else {
        data.paycheckBudgets[mk].categories[cat] = val;
    }
    saveData();
}

let _paycheckBudgetSaveTimer = null;

window.renderPaycheck = renderPaycheck;
window.openNewPaycheckModal = openNewPaycheckModal;
window.openEditPaycheckModal = openEditPaycheckModal;
window.saveNewPaycheck = saveNewPaycheck;
window.saveEditPaycheck = saveEditPaycheck;
window.deletePaycheck = deletePaycheck;
window.deleteThisAndFollowing = deleteThisAndFollowing;
window.deleteAllPaychecks = deleteAllPaychecks;
window.closePaycheckModal = closePaycheckModal;
window.navigatePaycheck = navigatePaycheck;
window.renderPaycheckNav = renderPaycheckNav;
window.updatePaycheckPageTitle = updatePaycheckPageTitle;
window.togglePaycheckDropdown = togglePaycheckDropdown;
window.renderAllPaycheck = renderAllPaycheck;
window.renderPaycheckHeader = renderPaycheckHeader;
window.renderPaycheckNotes = renderPaycheckNotes;
window.savePaycheckNote = savePaycheckNote;
window.getPaychecks = getPaychecks;
window.getCurrentPaycheckIndex = getCurrentPaycheckIndex;
window.setCurrentPaycheckIndex = setCurrentPaycheckIndex;
window.formatPaycheckInterval = formatPaycheckInterval;
window.getPaycheckBills = getPaycheckBills;
window.savePaycheckCategoryBudget = savePaycheckCategoryBudget;
window.savePaycheckCategoryBudgetOnBlur = savePaycheckCategoryBudgetOnBlur;

function openPaycheckInfoModal() {
    if (localStorage.getItem("ultimatePaycheckPaycheckSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("paycheckInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closePaycheckInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckPaycheckSeen", "true");
    document.getElementById("paycheckInfoModal").classList.remove("active");
}

window.openPaycheckInfoModal = openPaycheckInfoModal;
window.closePaycheckInfoModal = closePaycheckInfoModal;
