const STORAGE_KEY = "ultimatePaycheckBudgetDataV1";

window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
        const _mySection = document.querySelector("nav button.active")?.dataset.section || "list";
        data = loadData();
        renderPageHeader(_mySection);
        renderFilterOptions();
        renderBills();
        renderCalendar();
        renderMonthlyInsights();
        renderYearlySummary();
        renderSettings();
        updateCurrencyInputDisplay();
        if (typeof renderAllPaycheck  === "function" && _mySection === "paycheck")  renderAllPaycheck();
        if (typeof renderAccountsPage === "function" && _mySection === "accounts") renderAccountsPage();
        if (typeof renderSavingsPage  === "function") renderSavingsPage();
        if (typeof renderDebtPage     === "function") renderDebtPage();
    }
});

const ACC_COL_TYPES = [
    { type: "cash", label: "Cash", emoji: "💵", cls: "acc-col-cash",
      help: "Cash accounts track physical money — banknotes, coins, or a wallet. Enter your current cash amount as the start balance.",
      nameHelp: "Use a name that helps you identify this cash source — for example: Wallet, Cash Drawer, Petty Cash.",
      namePlaceholder: "e.g. Wallet, Cash Drawer" },
    { type: "bank", label: "Bank", emoji: "🏦", cls: "acc-col-bank",
      help: "Bank accounts include checking and current accounts. Enter the balance shown in your bank app or statement as the start balance.",
      nameHelp: "Use a name that matches your bank account — for example: Main Checking, Revolut, Joint Account.",
      namePlaceholder: "e.g. Main Checking, Revolut" },
    { type: "savings", label: "Savings", emoji: "🐷", cls: "acc-col-savings",
      help: "Savings accounts are separate from your everyday spending. Enter your current savings balance as the start balance.",
      nameHelp: "Use a name that describes what you're saving for — for example: Emergency Fund, Vacation, House Deposit.",
      namePlaceholder: "e.g. Emergency Fund, Vacation" },
    { type: "credit", label: "Credit Card", emoji: "💳", cls: "acc-col-credit",
      help: "Credit card accounts track your card balance. Enter a <strong>negative</strong> start balance if you already have debt on the card (e.g. -500). Enter a <strong>positive</strong> balance if you overpaid and have money in your favor.",
      nameHelp: "Use a name you'll recognise easily — for example: Barclays Credit Card, ING Mastercard, Amex Gold.",
      namePlaceholder: "e.g. Barclays Credit Card, Amex Gold" },
    { type: "investment", label: "Investment", emoji: "📈", cls: "acc-col-investment",
      help: "Investment accounts include brokerage, retirement, or portfolio accounts. Enter the current value of your investments as the start balance.",
      nameHelp: "Use a name that identifies the platform or fund — for example: Trading 212, Vanguard ISA, Pension Fund.",
      namePlaceholder: "e.g. Trading 212, Vanguard ISA" }
];

window._ACCOUNT_EMOJIS = {
    bank: "🏦",
    cash: "💵",
    savings: "🐷",
    investment: "📈",
    credit: "💳"
};

window._ACCOUNT_LABELS = {
    bank: "Bank",
    cash: "Cash",
    savings: "Savings",
    investment: "Investment",
    credit: "Credit card"
};

const defaultData = {
    settings: {
        currencySymbol: "",
        currencyPosition: "",
        weekStart: ""
    },
    categories: [
        "Income",
        "Savings",
        "Bills",
        "Expenses",
        "Debt Payments"
    ],
    billDefaults: {
        id: null,
        seriesId: null,
        name: "",
        category: "",
        type: "payment",
        amount: 0,
        actualAmount: null,
        dueDate: "",
        actualDate: null,
        priority: 2,
        frequency: "one-time",
        interval: 1,
        endDate: null,
        notes: "",
        paid: false,
        fromAccount: null,
        toAccount: null,
        debtId: null,
        debtGenerated: false,
        debtPrincipal: null,
        debtInterest: null,
        actualDebtPrincipal: null,
        actualDebtInterest: null
    },
    bills: [],
    customCurrencies: [],
    billNameGroups: [],
    priorityNames: ["Critical", "High", "Medium", "Low", "Optional"],
    monthlyBudgets: {},
    paychecks: [],
    paycheckBudgets: {},
    paycheckSettings: {
        frequency: "custom",
        startDate: "",
        namePrefix: "Paycheck"
    },
    accounts: [],
    debts: [],
    savingsGoals: [],
    debtPlan: {
        strategy: "snowball",
        monthlyBudgets: {},
        customOrder: []
    }
};

let data = loadData();
function isIncomeCategory(cat) { return cat === data.categories[0]; }
function isSavingsCategory(cat) { return cat === data.categories[1]; }
let activeFilter = "all";
let currentCalendarDate = new Date();
let backupDirty = false;
let selectedCalDay = null;

const HISTORY_LIMIT = 50;
let undoStack = [];
let redoStack = [];
let isRestoringHistory = false;
let lastSavedSnapshot = null;

function cloneAppData() {
    return structuredClone(normalizeAppData(data));
}

function snapshotsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function restoreHistorySnapshot(snapshot) {
    isRestoringHistory = true;
    updateHistoryButtons();

    const panel = document.getElementById("calDayPanel");
    const wasExpanded = panel?.classList.contains("expanded");
    const previousSelectedDay = selectedCalDay;

    data = structuredClone(snapshot);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    selectedCalDay = previousSelectedDay;

    loadBillNames();
    renderCategoryOptions();
    renderCustomCurrencies();
    renderSettings();
    renderAll();

    if (wasExpanded && selectedCalDay) {
        requestAnimationFrame(() => {
            toggleCalDrawer(true);
        });
    }

    lastSavedSnapshot = cloneAppData();
    backupDirty = true;
    autoSaveToBackup();

    isRestoringHistory = false;
}

function undoChange() {

    if (!undoStack.length) return;

    redoStack.push({
        snapshot: cloneAppData()
    });

    const previous = undoStack.pop();
    restoreHistorySnapshot(previous.snapshot);
    updateHistoryButtons();
}

function redoChange() {
    if (!redoStack.length) return;

    undoStack.push({
        snapshot: cloneAppData()
    });

    const next = redoStack.pop();
    restoreHistorySnapshot(next.snapshot);
    updateHistoryButtons();
}

function updateHistoryButtons() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");

    if (undoBtn) {
        undoBtn.disabled = undoStack.length === 0;
    }

    if (redoBtn) {
        redoBtn.disabled = redoStack.length === 0;
    }
}

const els = {
    pageTitle: document.getElementById("pageTitle"),
    todayText: document.getElementById("todayText"),
    totalBills: document.getElementById("totalBills"),
    paidBills: document.getElementById("paidBills"),
    unpaidBills: document.getElementById("unpaidBills"),
    overdueBills: document.getElementById("overdueBills"),
    billList: document.getElementById("billList"),
    billForm: document.getElementById("billForm"),
    editingId: document.getElementById("editingId"),
    billName: document.getElementById("billName"),
    billCategory: document.getElementById("billCategory"),
    billAmount: document.getElementById("billAmount"),
    billType: document.getElementById("billType"),
    billPriority: document.getElementById("billPriority"),
    billFrequency: document.getElementById("billFrequency"),
    billInterval: document.getElementById("billInterval"),
    billIntervalWrap: document.getElementById("billIntervalWrap"),
    billEndDate: document.getElementById("billEndDate"),
    billPaidAmount: document.getElementById("billPaidAmount"),
    billPaidAmountWrap: document.getElementById("billPaidAmountWrap"),
    billInterest: document.getElementById("billInterest"),
    billInterestWrap: document.getElementById("billInterestWrap"),
    billPaidInterest: document.getElementById("billPaidInterest"),
    billPaidInterestWrap: document.getElementById("billPaidInterestWrap"),
    billPaidDate: document.getElementById("billPaidDate"),
    billPaidDateWrap: document.getElementById("billPaidDateWrap"),
    billEndDateWrap: document.getElementById("billEndDateWrap"),
    billDate: document.getElementById("billDate"),
    billNotes: document.getElementById("billNotes"),
    saveBillBtn: document.getElementById("saveBillBtn"),
    cancelEditBtn: document.getElementById("cancelEditBtn"),
    calendarGrid: document.getElementById("calendarGrid"),
    calendarTitle: document.getElementById("calendarTitle"),
    categoryBreakdown: document.getElementById("categoryBreakdown"),
    currencySymbol: document.getElementById("currencySymbol"),
    currencyPosition: document.getElementById("currencyPosition"),
    weekStart: document.getElementById("weekStart"),
    paycheckFrequency: document.getElementById("paycheckFrequency"),
    paycheckStartDate: document.getElementById("paycheckStartDate"),
    paycheckNamePrefix: document.getElementById("paycheckNamePrefix"),
    highlightPaycheckCalendar: document.getElementById("highlightPaycheckCalendar")
};

function extendRecurringSeries() {
    const endOfNextYear = new Date(new Date().getFullYear() + 1, 11, 31);
    let added = false;

    // Grupează după seriesId
    const seriesMap = {};
    for (const bill of data.bills) {
        if (bill.frequency === "one-time") continue;
        if (!seriesMap[bill.seriesId]) seriesMap[bill.seriesId] = [];
        seriesMap[bill.seriesId].push(bill);
    }

    for (const seriesId in seriesMap) {
        const series = seriesMap[seriesId];

        // Găsește ultimul bill din serie
        const last = series.reduce((a, b) =>
            parseLocalDate(a.dueDate) >= parseLocalDate(b.dueDate) ? a : b
        );

        const lastDate = parseLocalDate(last.dueDate);
        const seriesEndDate = last.endDate ? parseLocalDate(last.endDate) : null;
        const extendTo = seriesEndDate && seriesEndDate < endOfNextYear ? seriesEndDate : endOfNextYear;
        if (lastDate >= extendTo) continue;

        // Calculează next occurrence de la lastDate
        const next = new Date(lastDate);
        switch (last.frequency) {
            case "daily": next.setDate(next.getDate() + last.interval); break;
            case "weekly": next.setDate(next.getDate() + 7 * last.interval); break;
            case "monthly": { const _day270 = next.getDate(); next.setDate(1); next.setMonth(next.getMonth() + last.interval); next.setDate(Math.min(_day270, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())); break; }
            case "yearly": next.setFullYear(next.getFullYear() + last.interval); break;
        }

        if (next > extendTo) continue;

        // Generează de la next în continuare
        const template = { ...last };
        template.dueDate = toLocalDateInputValue(next);

        const newBills = generateRecurringBills(template).map(b => ({
            ...b,
            id: crypto.randomUUID(),
            seriesId: seriesId
        }));

        data.bills.push(...newBills);
        added = true;
    }

    if (added) saveData();
}

let resizeTimer;
let lastWindowWidth = window.innerWidth;
let currentActiveSection = localStorage.getItem("ultimatePaycheckActiveSection") || "list";
let listFiltersLoaded = false;
window.addEventListener("resize", () => {
    const newWidth = window.innerWidth;
    if (newWidth === lastWindowWidth) return;
    lastWindowWidth = newWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        renderAll();
    }, 150);
});

window.addEventListener("scroll", () => {
    const topbar = document.querySelector(".topbar");
    if (window.scrollY > 10) {
        topbar.classList.add("scrolled");
    } else {
        topbar.classList.remove("scrolled");
    }
}, { passive: true });

(function () {
    const grid = document.getElementById("summaryGrid");
    const btnLeft = document.getElementById("summaryArrowLeft");
    const btnRight = document.getElementById("summaryArrowRight");

    if (!grid || !btnLeft || !btnRight) return;

    function updateArrows() {
        const atStart = grid.scrollLeft <= 4;
        const atEnd = grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 4;
        btnLeft.classList.toggle("hidden", atStart);
        btnRight.classList.toggle("hidden", atEnd);
    }

    grid.addEventListener("scroll", updateArrows, { passive: true });

    btnLeft.addEventListener("click", () => {
        grid.scrollBy({ left: -120, behavior: "smooth" });
    });

    btnRight.addEventListener("click", () => {
        grid.scrollBy({ left: 120, behavior: "smooth" });
    });

    function syncArrowHeight() {
        const h = grid.offsetHeight;
        if (h > 0) document.documentElement.style.setProperty("--sgrid-h", h + "px");
    }
    updateArrows();
    syncArrowHeight();
    setTimeout(() => { updateArrows(); syncArrowHeight(); }, 300);
})();

function init() {
    document.title = `Ultimate Paycheck Budget App v${APP_VERSION}`;
    const versionEl = document.getElementById("appVersion");
    if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
    renderMiniCalendar();
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isOnline = window.location.protocol === "https:";
    const menuActivation = document.getElementById("menuActivation");
    if (menuActivation) menuActivation.style.display = isActivated() ? "none" : "";
    applyHiddenMenuItems();
    if (isMobile || isOnline) {
        const autoBackup = document.getElementById("autoBackupSection");
        if (autoBackup) autoBackup.style.display = "none";
    }
    renderMiniCalendar("miniCalendarDesktop");
    // todayText is rendered dynamically - see renderSummaryCards
    renderCategoryOptions();
    renderCustomCurrencies();
    renderSettings();
    updateRecurringFieldsVisibility();
    extendRecurringSeries();
    renderAll();
    undoStack = [];
    redoStack = [];
    lastSavedSnapshot = cloneAppData();
    updateHistoryButtons();

    bindEvents();
    showWelcomeBackupReminder();
    document.addEventListener("mouseover", (e) => {
        const trigger = e.target.closest("#calendarTitle .csd-trigger");
        if (!trigger) return;
        const arrowHover = trigger.dataset.arrowHover;
        if (!arrowHover) return;
        trigger.style.setProperty("background-image", `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='${arrowHover}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E")`, "important");
    });
    document.addEventListener("mouseout", (e) => {
        const trigger = e.target.closest("#calendarTitle .csd-trigger");
        if (!trigger) return;
        const arrow = trigger.dataset.arrow;
        if (!arrow) return;
        trigger.style.setProperty("background-image", `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='${arrow}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E")`, "important");
    });

    const savedSection = localStorage.getItem("ultimatePaycheckActiveSection");
    const hasSeenQuickStart = localStorage.getItem("ultimatePaycheckHasSeenQuickStart");

    if (!hasSeenQuickStart) {
        showSection("quickstart");
        localStorage.setItem("ultimatePaycheckHasSeenQuickStart", "true");
    } else if (savedSection) {
        showSection(savedSection);
        if (savedSection === "paycheck") renderAllPaycheck();
    } else {
        showSection("list");
    }
    setTimeout(updateBackupFolderDisplay, 100);
    updateHistoryButtons();
}

function normalizeAppData(rawData = {}) {
    const base = structuredClone(defaultData);
    const source = rawData && typeof rawData === "object" ? rawData : {};

    return {
        ...base,
        ...source,
        settings: {
            ...base.settings,
            ...(source.settings || {})
        },
        categories: (() => {
            const cats = Array.isArray(source.categories) ? source.categories : base.categories;
            return cats.filter(c => c !== "Transfers");
        })(),
        bills: Array.isArray(source.bills)
            ? source.bills.map(bill => {
                const merged = {
                    ...base.billDefaults,
                    ...bill,
                    seriesId: bill.seriesId || bill.id || crypto.randomUUID(),
                    type: bill.type || "payment",
                    actualAmount: bill.actualAmount ?? null,
                    actualDate: bill.actualDate ?? null,
                    priority: Number.isInteger(bill.priority) ? bill.priority : 2,
                    frequency: bill.frequency || "one-time",
                    interval: Number(bill.interval) > 0 ? Number(bill.interval) : 1,
                    endDate: bill.endDate ?? null,
                    paid: Boolean(bill.paid),
                    debtId: bill.debtId ?? null,
                    debtGenerated: bill.debtGenerated ?? false,
                    debtPrincipal: bill.debtPrincipal ?? null,
                    debtInterest: bill.debtInterest ?? null,
                    actualDebtPrincipal: bill.actualDebtPrincipal ?? null,
                    actualDebtInterest: bill.actualDebtInterest ?? null
                };
                // Pre-redesign data: a real paid amount was recorded but there was no separate
                // "actual interest" field yet — the planned debtInterest estimate was the only
                // number available, so it carries forward as the real interest too, and the real
                // principal is whatever's left of the real total. debtPrincipal/debtInterest stay
                // untouched as the original plan (same as amount always has).
                if (merged.category === "Debt Payments" && merged.debtInterest != null
                    && merged.actualAmount != null && merged.actualDebtPrincipal == null) {
                    merged.actualDebtInterest = merged.debtInterest;
                    merged.actualDebtPrincipal = Math.max(parseFloat(merged.actualAmount) - parseFloat(merged.debtInterest), 0);
                }
                return merged;
            })
            : [],
        customCurrencies: Array.isArray(source.customCurrencies) ? source.customCurrencies : [],
        billNameGroups: Array.isArray(source.billNameGroups) ? source.billNameGroups : [],
        priorityNames: Array.isArray(source.priorityNames) ? source.priorityNames : base.priorityNames,
        monthlyBudgets: source.monthlyBudgets && typeof source.monthlyBudgets === "object" ? source.monthlyBudgets : {},
        paychecks: Array.isArray(source.paychecks) ? source.paychecks : [],
        paycheckBudgets: source.paycheckBudgets && typeof source.paycheckBudgets === "object" ? source.paycheckBudgets : {},
        paycheckSettings: source.paycheckSettings && typeof source.paycheckSettings === "object" ? source.paycheckSettings : { frequency: "custom", startDate: "", namePrefix: "Paycheck" },
        accounts: Array.isArray(source.accounts) ? source.accounts : [],
        debts: Array.isArray(source.debts) ? source.debts : [],
        savingsGoals: Array.isArray(source.savingsGoals) ? source.savingsGoals : [],
        debtPlan: source.debtPlan && typeof source.debtPlan === "object"
            ? {
                ...base.debtPlan,
                ...source.debtPlan,
                monthlyBudgets: source.debtPlan.monthlyBudgets && typeof source.debtPlan.monthlyBudgets === "object"
                    ? source.debtPlan.monthlyBudgets
                    : {}
            }
            : structuredClone(base.debtPlan)
    };
}

function loadData() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return normalizeAppData();

        return normalizeAppData(JSON.parse(saved));
    } catch (error) {
        return normalizeAppData();
    }
}

function saveData() {
    if (!isRestoringHistory) {
        const currentSnapshot = cloneAppData();

        if (!lastSavedSnapshot) {
            lastSavedSnapshot = currentSnapshot;
        } else if (!snapshotsEqual(lastSavedSnapshot, currentSnapshot)) {
            undoStack.push({
                snapshot: structuredClone(lastSavedSnapshot)
            });

            if (undoStack.length > HISTORY_LIMIT) {
                undoStack.shift();
            }

            redoStack = [];
            lastSavedSnapshot = currentSnapshot;
        }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    backupDirty = true;
    updateHistoryButtons();
    autoSaveToBackup();
}

function updateFilterStyles() {
    // toggle "All" pill based on whether any filter is active
    const billListFilters = ["filterStatus", "filterPriority", "filterCategory", "filterMonth", "filterYear"];
    const calFilters = ["calFilterStatus", "calFilterPriority", "calFilterCategory", "calFilterMonth", "calFilterYear"];

    const billAnyActive = billListFilters.some(id => {
        const el = document.getElementById(id);
        return el && el.value !== "";
    });
    const filterAllBtn = document.getElementById("filterAll");
    if (filterAllBtn) filterAllBtn.classList.toggle("active", !billAnyActive);

    const calAnyActive = calFilters.some(id => {
        const el = document.getElementById(id);
        return el && el.value !== "";
    });
    const calFilterAllBtn = document.getElementById("calFilterAll");
    if (calFilterAllBtn) calFilterAllBtn.classList.toggle("active", !calAnyActive);
}

function bindEvents() {

    // ── Custom Select Dropdowns ──────────────────────────
    function getOptionColor(selectId, value) {
        if (value === "") return "default";
        if (selectId === "filterStatus" || selectId === "calFilterStatus") return value;
        if (selectId === "filterPriority" || selectId === "calFilterPriority") return `pri-${value}`;
        if (selectId === "filterCategory" || selectId === "calFilterCategory") {
            if (value === "Transfers") return "cat-6";
            if (value === "Investments") return "cat-7";
            const idx = data.categories.indexOf(value);
            return idx !== -1 ? `cat-${idx + 1}` : "default";
        }
        if (selectId === "accFilterType") {
            const map = { cash: "cat-3", bank: "cat-1", savings: "cat-2", credit: "cat-5", investment: "cat-7" };
            return map[value] || "default";
        }
        if (selectId === "filterMonth" || selectId === "calFilterMonth" || selectId === "accFilterMonth") return `month-${value}`;
        if (selectId === "filterYear"  || selectId === "calFilterYear"  || selectId === "accFilterYear")  return "year";
        if (selectId === "calNavPeriod") {
            const m = parseInt(value.split("-")[1]) + 1;
            return `month-${m}`;
        }
        return "default";
    }

    function initCustomSelect(selectEl) {
        if (!selectEl || selectEl.dataset.csdInit) return;
        selectEl.dataset.csdInit = "true";
        selectEl.style.display = "none";

        const isForm = selectEl.classList.contains("form-select");

        const wrapper = document.createElement("div");
        wrapper.className = isForm ? "csd-wrapper csd-form" : "csd-wrapper";
        if (selectEl.id) wrapper.dataset.selectId = selectEl.id;
        selectEl.parentNode.insertBefore(wrapper, selectEl);
        wrapper.appendChild(selectEl);

        const trigger = document.createElement("div");
        trigger.className = "csd-trigger";
        trigger.tabIndex = 0;
        wrapper.appendChild(trigger);

        const dropdown = document.createElement("div");
        dropdown.className = "csd-dropdown";
        dropdown.style.display = "none";
        wrapper.appendChild(dropdown);

        function syncTrigger() {
            const opt = selectEl.options[selectEl.selectedIndex];
            trigger.textContent = opt ? opt.text : "";

            if (selectEl.id === "calNavPeriod") {
                return;
            }

            trigger.className = "csd-trigger";
            trigger.style.backgroundColor = "";
            trigger.style.borderColor = "";
            trigger.style.color = "";
            trigger.style.backgroundImage = "";

            if (isForm) {
                trigger.classList.toggle("csd-has-value", selectEl.value !== "");
                return;
            }

            if (selectEl.value === "") return;

            const color = getOptionColor(selectEl.id, selectEl.value);
            if (color === "default" || color === "") return;

            const colorMap = {
                "paid": { bg: "var(--priority-4-bg)", border: "var(--priority-4-color)", text: "var(--priority-4-color)", arrow: "%2343a047" },
                "unpaid": { bg: "var(--priority-3-bg)", border: "var(--priority-3-color)", text: "var(--priority-3-color)", arrow: "%23c6a800" },
                "overdue": { bg: "var(--priority-1-bg)", border: "var(--priority-1-color)", text: "var(--priority-1-color)", arrow: "%23e53935" },
                "pri-0": { bg: "var(--priority-1-bg)", border: "var(--priority-1-color)", text: "var(--priority-1-color)", arrow: "%23e53935" },
                "pri-1": { bg: "var(--priority-2-bg)", border: "var(--priority-2-color)", text: "var(--priority-2-color)", arrow: "%23e8720c" },
                "pri-2": { bg: "var(--priority-3-bg)", border: "var(--priority-3-color)", text: "var(--priority-3-color)", arrow: "%23c6a800" },
                "pri-3": { bg: "var(--priority-4-bg)", border: "var(--priority-4-color)", text: "var(--priority-4-color)", arrow: "%2343a047" },
                "pri-4": { bg: "var(--priority-5-bg)", border: "var(--priority-5-color)", text: "var(--priority-5-color)", arrow: "%231e88e5" },
                "cat-1": { bg: "var(--mint-soft-2)", border: "var(--mint)", text: "var(--mint-text)", arrow: "%23037c7c" },
                "cat-2": { bg: "var(--purple-soft-2)", border: "var(--purple)", text: "var(--purple-text)", arrow: "%238c4698" },
                "cat-3": { bg: "var(--yellow-soft-2)", border: "var(--yellow)", text: "var(--yellow-text)", arrow: "%23c48600" },
                "cat-4": { bg: "var(--orange-soft-2)", border: "var(--orange)", text: "var(--orange-text)", arrow: "%23f36300" },
                "cat-5": { bg: "var(--pink-soft-2)", border: "var(--pink)", text: "var(--pink-text)", arrow: "%23fa3a7c" },
                "cat-6": { bg: "var(--peach-soft-2)", border: "var(--peach)", text: "var(--peach-text)", arrow: "%23d07b82" },
                "cat-7": { bg: "var(--blue-soft-2)", border: "var(--blue)", text: "var(--blue-text)", arrow: "%231565c0" },
                "month-1": { bg: "var(--pink-soft-2)", border: "var(--pink)", text: "var(--pink-text)", arrow: "%23fa3a7c" },
                "month-7": { bg: "var(--pink-soft-2)", border: "var(--pink)", text: "var(--pink-text)", arrow: "%23fa3a7c" },
                "month-2": { bg: "var(--orange-soft-2)", border: "var(--orange)", text: "var(--orange-text)", arrow: "%23f36300" },
                "month-8": { bg: "var(--orange-soft-2)", border: "var(--orange)", text: "var(--orange-text)", arrow: "%23f36300" },
                "month-3": { bg: "var(--yellow-soft-2)", border: "var(--yellow)", text: "var(--yellow-text)", arrow: "%23c48600" },
                "month-9": { bg: "var(--yellow-soft-2)", border: "var(--yellow)", text: "var(--yellow-text)", arrow: "%23c48600" },
                "month-4": { bg: "var(--mint-soft-2)", border: "var(--mint)", text: "var(--mint-text)", arrow: "%23037c7c" },
                "month-10": { bg: "var(--mint-soft-2)", border: "var(--mint)", text: "var(--mint-text)", arrow: "%23037c7c" },
                "month-5": { bg: "var(--purple-soft-2)", border: "var(--purple)", text: "var(--purple-text)", arrow: "%238c4698" },
                "month-11": { bg: "var(--purple-soft-2)", border: "var(--purple)", text: "var(--purple-text)", arrow: "%238c4698" },
                "month-6": { bg: "var(--peach-soft-2)", border: "var(--peach)", text: "var(--peach-text)", arrow: "%23d07b82" },
                "month-12": { bg: "var(--peach-soft-2)", border: "var(--peach)", text: "var(--peach-text)", arrow: "%23d07b82" },
                "year": { bg: "var(--purple-soft-2)", border: "var(--purple)", text: "var(--purple-text)", arrow: "%238c4698" },
            };

            const c = colorMap[color];
            if (c) {
                trigger.style.backgroundColor = c.bg;
                trigger.style.borderColor = c.border;
                trigger.style.color = c.text;
                trigger.style.backgroundImage = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='${c.arrow}' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`;
                trigger.style.backgroundRepeat = "no-repeat";
                trigger.style.backgroundPosition = "right 10px center";
            }
        }

        function buildOptions() {
            dropdown.innerHTML = "";
            Array.from(selectEl.options).forEach(opt => {
                if (isForm && opt.value === "") return;
                const div = document.createElement("div");
                div.className = "csd-option";
                div.textContent = opt.text;
                div.dataset.value = opt.value;
                div.dataset.color = getOptionColor(selectEl.id, opt.value);
                if (opt.value === selectEl.value) div.classList.add("csd-selected");
                div.addEventListener("click", () => {
                    selectEl.value = opt.value;
                    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                    closeDropdown();
                });
                dropdown.appendChild(div);
            });
        }

        function openDropdown() {
            buildOptions();
            dropdown.style.display = "flex";
            trigger.classList.add("csd-open");
        }

        function closeDropdown() {
            dropdown.style.display = "none";
            trigger.classList.remove("csd-open");
            syncTrigger();
        }

        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display !== "none";
            document.querySelectorAll(".csd-dropdown").forEach(d => {
                d.style.display = "none";
                d.closest(".csd-wrapper")?.querySelector(".csd-trigger")?.classList.remove("csd-open");
            });
            if (!isOpen) openDropdown();
        });

        trigger.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); trigger.click(); }
            if (e.key === "Escape") closeDropdown();
        });

        document.addEventListener("click", (e) => {
            if (!wrapper.contains(e.target)) closeDropdown();
        });

        new MutationObserver(() => syncTrigger()).observe(selectEl, { attributes: true, childList: true, subtree: true });

        syncTrigger();
    }

    function initAllCustomSelects() {
        document.querySelectorAll(".filter-pill-select, .form-select").forEach(sel => initCustomSelect(sel));
    }

    function syncCustomSelect(id) {
        const sel = document.getElementById(id);
        if (!sel) return;
        const wrapper = sel.closest(".csd-wrapper");
        if (!wrapper) return;
        const trigger = wrapper.querySelector(".csd-trigger");
        if (!trigger) return;
        const opt = sel.options[sel.selectedIndex];
        trigger.textContent = opt ? opt.text : "";
        trigger.classList.toggle("csd-has-value", sel.value !== "");
    }

    window.initCustomSelect = initCustomSelect;
    window.initAllCustomSelects = initAllCustomSelects;
    window.syncCustomSelect = syncCustomSelect;
    initAllCustomSelects();
    // ── End Custom Select Dropdowns ──────────────────────

    document.getElementById("toggleSidebar").onclick = () => {
        const app = document.querySelector(".app");
        const btn = document.getElementById("toggleSidebar");

        app.classList.toggle("collapsed");

        const panel = document.getElementById("iconPanel");
        const hamburger = document.getElementById("iconHamburger");
        if (app.classList.contains("collapsed")) {
            panel.style.display = "none";
            hamburger.style.display = "block";
        } else {
            panel.style.display = "block";
            hamburger.style.display = "none";
            panel.style.animation = "none";
            if ((data.bills || []).length > 0) {
                requestAnimationFrame(() => {
                    panel.style.animation = "";
                });
            }
        }

    };

    document.getElementById("mobileMenuBtn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelector(".app").classList.toggle("mobile-menu-open");
    });

    document.getElementById("mobileCloseBtn")?.addEventListener("click", () => {
        document.querySelector(".app").classList.remove("mobile-menu-open");
    });

    document.addEventListener("click", (e) => {
        const app = document.querySelector(".app");
        if (!app.classList.contains("mobile-menu-open")) return;
        const aside = document.querySelector("aside");
        if (aside && !aside.contains(e.target)) {
            app.classList.remove("mobile-menu-open");
        }
    });

    document.querySelectorAll("nav button").forEach(button => {
        button.addEventListener("click", () => {
            if (button.id === "menuActivation") { document.querySelector(".app").classList.remove("mobile-menu-open"); showActivationModal(); return; }
            if (!button.dataset.section) return;
            showSection(button.dataset.section);
            document.querySelector(".app").classList.remove("mobile-menu-open");
        });
    });

    document.getElementById("filterAll")?.addEventListener("click", () => {
        ["filterStatus", "filterPriority", "filterCategory", "filterMonth", "filterYear"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        updateFilterStyles();
        renderBills();
        updateSectionLabel("list");
    });

    ["filterStatus", "filterPriority", "filterCategory", "filterMonth", "filterYear"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", () => {
            updateFilterStyles();
            renderBills();
            renderListProgressBar();
            updateSectionLabel("list");
        });
    });

    // Filters modal - mobil
    const isMobile = () => window.innerWidth <= 1040;

    document.getElementById("filtersToggleBtn")?.addEventListener("click", (e) => {
        if (e.target.classList.contains("help-icon")) return;
        const modal = document.getElementById("filtersModal");
        const body = document.getElementById("filtersModalBody");
        const row = document.getElementById("filtersAllRow");
        if (modal && body && row) {
            body.appendChild(row);
            row.classList.add("in-modal");
            modal.style.display = "flex";
        }
    });

    document.getElementById("filtersModalClose")?.addEventListener("click", () => {
        const modal = document.getElementById("filtersModal");
        const bar = document.querySelector(".filters-bar");
        const row = document.getElementById("filtersAllRow");
        if (row && bar) {
            row.classList.remove("in-modal");
            bar.appendChild(row);
        }
        if (modal) modal.style.display = "none";
    });

    document.getElementById("filtersModal")?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) {
            const bar = document.querySelector(".filters-bar");
            const row = document.getElementById("filtersAllRow");
            if (row && bar) bar.appendChild(row);
            e.currentTarget.style.display = "none";
        }
    });

    // Calendar filters event listeners
    document.getElementById("calFilterAll")?.addEventListener("click", () => {
        ["calFilterStatus", "calFilterPriority", "calFilterCategory", "calFilterMonth", "calFilterYear"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        document.getElementById("calFilterAll")?.classList.add("active");
        renderCalendar();
    });

    ["calFilterStatus", "calFilterPriority", "calFilterCategory", "calFilterMonth", "calFilterYear"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", () => {
            updateFilterStyles();
            renderCalendar();
            updateSectionLabel("calendar");
        });
    });

    document.getElementById("calFiltersToggleBtn")?.addEventListener("click", (e) => {
        if (e.target.classList.contains("help-icon")) return;
        const modal = document.getElementById("calFiltersModal");
        const body = document.getElementById("calFiltersModalBody");
        const row = document.getElementById("calFiltersAllRow");
        if (modal && body && row) {
            body.appendChild(row);
            row.classList.add("in-modal");
            modal.style.display = "flex";
        }
    });

    document.getElementById("calFiltersModalClose")?.addEventListener("click", () => {
        const modal = document.getElementById("calFiltersModal");
        const bar = document.getElementById("section-calendar").querySelector(".filters-bar");
        const row = document.getElementById("calFiltersAllRow");
        if (row && bar) {
            row.classList.remove("in-modal");
            bar.appendChild(row);
        }
        if (modal) modal.style.display = "none";
    });
    document.getElementById("calFiltersModal")?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) {
            const bar = document.getElementById("section-calendar").querySelector(".filters-bar");
            const row = document.getElementById("calFiltersAllRow");
            if (row && bar) {
                row.classList.remove("in-modal");
                bar.appendChild(row);
            }
            e.currentTarget.style.display = "none";
        }
    });

    document.getElementById("addBillBtn")?.addEventListener("click", () => {
        resetForm();
        openAddBillModal();
    });

    document.getElementById("addBillBtnMobile")?.addEventListener("click", () => {
        resetForm();
        openAddBillModal();
    });

    ["calAddBillBtn", "calAddBillBtnMobile"].forEach(id => {
        document.getElementById(id)?.addEventListener("click", () => {
            if (selectedCalDay) {
                openAddBillWithDate(selectedCalDay);
            } else {
                resetForm();
                openAddBillModal();
            }
        });
    });

    els.billForm.addEventListener("submit", handleSaveBill);

    document.getElementById("saveAndAddBtn").addEventListener("click", () => {
        window._saveAndAdd = true;
        els.saveBillBtn.click();
    });

    document.getElementById("saveAndPaidBtn").addEventListener("click", () => {
        if (window._saveAndPaidEditFn) {
            window._saveAndPaidEditFn();
        } else {
            window._saveAndMarkPaid = true;
            els.saveBillBtn.click();
        }
    });

    els.cancelEditBtn.addEventListener("click", () => {
        resetForm();
        closeAddBillModal();
    });

    els.billFrequency.addEventListener("change", () => {
        updateRecurringFieldsVisibility();
        updateSavingsMonthlyHint();
        updateSavingsEndDateHint();
    });
    els.billCategory.addEventListener("change", () => {
        renderBillNameOptions();
        updateTypeOptions();
        updateSaveAndMarkBtn();
        updatePaidLabels();
        updateBillPaidAmountVisibility();
        updateSavingsMonthlyHint();
        updateSavingsEndDateHint();
    });
    els.billType.addEventListener("change", () => {
        if (els.editingId.value) return;
        updateTypeOptions();
        updateSaveAndMarkBtn();
        updatePaidLabels();
        updateBillPaidAmountVisibility();
        updateDebtPaymentAccounts();
        updateSavingsAccounts();
        updateSavingsMonthlyHint();
        updateSavingsEndDateHint();
    });

    els.billName.addEventListener("change", () => {
        if (els.billName.value === "__go_settings__") {
            closeAddBillModal();
            showSection("settings");
            return;
        }
        if (els.billCategory.value === "Debt Payments") {
            updateDebtPaymentAccounts();
        }
        if (isSavingsCategory(els.billCategory.value)) {
            updateSavingsAccounts(true);
        }
        updateSavingsMonthlyHint();
        updateSavingsEndDateHint();
    });

    els.billAmount.addEventListener("input", () => {
        if (svAmountPreFilled) {
            const hintEl = document.getElementById("svAmountHint");
            if (hintEl) hintEl.style.display = "none";
            svAmountPreFilled = false;
        }
        updateSavingsEndDateHint();
    });

    els.billInterval.addEventListener("input", updateSavingsMonthlyHint);
    els.billInterval.addEventListener("input", updateSavingsEndDateHint);
    els.billDate.addEventListener("change", updateSavingsMonthlyHint);
    els.billDate.addEventListener("change", updateSavingsEndDateHint);

    document.getElementById("billFrom").addEventListener("change", () => {
        filterAccountDropdowns();
    });

    document.getElementById("billTo").addEventListener("change", () => {
        filterAccountDropdowns();
    });

    els.billAmount.addEventListener("blur", () => {
        const value = Number(els.billAmount.value);

        if (!Number.isNaN(value) && els.billAmount.value !== "") {
            els.billAmount.value = value.toFixed(2);
        }
    });

    els.billPaidAmount.addEventListener("blur", () => {
        const value = Number(els.billPaidAmount.value);

        if (!Number.isNaN(value) && els.billPaidAmount.value !== "") {
            els.billPaidAmount.value = value.toFixed(2);
        }
    });

    ["savingsGoalAmount", "savingsGoalStartAmount", "accountCreditLimit"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("blur", () => {
            const value = Number(el.value);
            if (!Number.isNaN(value) && el.value !== "") {
                el.value = value.toFixed(2);
            }
        });
    });

    const startAmountEl = document.getElementById("savingsGoalStartAmount");
    if (startAmountEl) {
        startAmountEl.addEventListener("focus", () => {
            if (!document.getElementById("savingsGoalAccount")?.value) return;
            let tip = document.getElementById("savingsFundAmountTip");
            if (!tip) {
                tip = document.createElement("div");
                tip.id = "savingsFundAmountTip";
                tip.style.cssText = "position:fixed;z-index:9999;background:var(--card);border:1.5px solid var(--red-overdue);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--red-overdue);max-width:280px;box-shadow:0 4px 12px rgba(0,0,0,0.12);pointer-events:none;";
                tip.innerHTML = "⚠️ If this is the <strong>only</strong> fund on this account, the Start amount should equal the account's Start balance. If <strong>multiple</strong> funds share one account, the sum of all their Start amounts must equal the account's Start balance.";
                document.body.appendChild(tip);
            }
            const rect = startAmountEl.getBoundingClientRect();
            tip.style.display = "block";
            tip.style.left = rect.left + "px";
            tip.style.top = (rect.top - tip.offsetHeight - 8) + "px";
        });
        startAmountEl.addEventListener("blur", () => {
            const tip = document.getElementById("savingsFundAmountTip");
            if (tip) tip.style.display = "none";
        });
    }

    document.getElementById("calNavPeriod")?.addEventListener("change", (e) => {
        const [y, m] = e.target.value.split("-").map(Number);
        currentCalendarDate.setFullYear(y);
        currentCalendarDate.setMonth(m);
        renderCalendar();
    });

    document.getElementById("prevMonth").addEventListener("click", () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
        renderAll();
    });

    document.getElementById("nextMonth").addEventListener("click", () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
        renderAll();
    });

    function resetCurrencyModal() {
        document.getElementById("customCurrencyName").value = "";
        document.getElementById("customCurrencySymbol").value = "";
        document.getElementById("currencyError").textContent = "";
    }

    els.currencySymbol.addEventListener("change", () => {
        if (els.currencySymbol.value === "__add_custom__") {
            resetCurrencyModal();
            document.getElementById("currencyModal").classList.add("active");
            els.currencySymbol.value = "";
        }
    });

    document.getElementById("closeCurrencyModal").addEventListener("click", () => {
        resetCurrencyModal();
        document.getElementById("currencyModal").classList.remove("active");
    });

    document.getElementById("addCustomCurrency").addEventListener("click", () => {
        const name = document.getElementById("customCurrencyName").value.trim();
        const symbol = document.getElementById("customCurrencySymbol").value.trim();
        const error = document.getElementById("currencyError");

        error.textContent = "";

        if (!name || !symbol) {
            error.textContent = "Please enter both currency name and symbol.";
            return;
        }

        if (symbol.length > 5) {
            error.textContent = "Currency symbol should be 5 characters or less.";
            return;
        }

        if (data.customCurrencies.some(c => c.symbol.toLowerCase() === symbol.toLowerCase())) {
            error.textContent = "This currency already exists.";
            return;
        }

        const addOption = els.currencySymbol.querySelector('option[value="__add_custom__"]');

        const option = document.createElement("option");
        option.value = symbol;
        option.textContent = `${name} (${symbol})`;

        els.currencySymbol.insertBefore(option, addOption);
        els.currencySymbol.value = symbol;

        data.customCurrencies.push({ name, symbol });
        data.settings.currencySymbol = symbol;
        saveData();
        renderCategoryOptions();

        resetCurrencyModal();
        document.getElementById("currencyModal").classList.remove("active");
    });

    document.getElementById("undoBtn")?.addEventListener("click", undoChange);
    document.getElementById("redoBtn")?.addEventListener("click", redoChange);

    document.getElementById("quickExportBtn")?.addEventListener("click", exportJson);
    document.getElementById("quickImportBtn")?.addEventListener("click", smartImportBackup);

    document.getElementById("exportJson").addEventListener("click", exportJson);
    document.getElementById("backupNowBtn").addEventListener("click", async () => {
        await exportJson();

        document.getElementById("backupReminderModal").classList.remove("active");
    });

    document.getElementById("closeBackupReminder").addEventListener("click", () => {
        document.getElementById("backupReminderModal").classList.remove("active");
    });

    document.getElementById("closeWelcomeBackup").addEventListener("click", () => {
        document.getElementById("welcomeBackupModal").classList.remove("active");
    });
    document.getElementById("welcomeImportBackupBtn").addEventListener("click", () => {
        document.getElementById("welcomeBackupModal").classList.remove("active");
        document.getElementById("importJson").click();
    });

    const importLatestBackupBtn = document.getElementById("importLatestBackup");

    if (importLatestBackupBtn) {
        importLatestBackupBtn.addEventListener("click", smartImportBackup);
    }

    document.getElementById("importJson").addEventListener("change", importJson);
    document.getElementById("exportCsv").addEventListener("click", exportCsv);
    document.getElementById("clearAll").addEventListener("click", clearAllData);

    document.addEventListener("change", (e) => {
        if (e.target.type === "date") {
            e.target.classList.toggle("has-value", !!e.target.value);
        }
    });

    document.addEventListener("click", (e) => {
        const helpIcon = e.target.closest(".help-icon[data-help]");
        if (!helpIcon) return;
        e.stopPropagation();
        document.getElementById("helpModalTitle").textContent = helpIcon.dataset.helpTitle || "Quick Help";
        document.getElementById("helpModalText").innerHTML = helpIcon.dataset.help;
        document.getElementById("helpModal").classList.add("active");
    });

    document.addEventListener("mouseover", (e) => {
        const helpIcon = e.target.closest(".help-icon[data-help]");
        if (helpIcon) showHelpIconTooltip(helpIcon);
    });
    document.addEventListener("mouseout", (e) => {
        const helpIcon = e.target.closest(".help-icon[data-help]");
        if (helpIcon) hideHelpIconTooltip();
    });
    window.addEventListener("scroll", hideHelpIconTooltip, true);

    // Delete recurring modal
    const closeDeleteModal = () => {
        document.getElementById("deleteRecurringModal").classList.remove("active");
        window._deletingBillId = null;
    };

    document.getElementById("deleteThisOnly").addEventListener("click", () => {
        const id = window._deletingBillId;
        data.bills = data.bills.filter(b => b.id !== id);
        saveData();
        renderAll();
        closeDeleteModal();
    });

    document.getElementById("deleteEntireSeries").addEventListener("click", () => {
        const id = window._deletingBillId;
        const bill = data.bills.find(b => b.id === id);
        if (!bill) return closeDeleteModal();
        data.bills = data.bills.filter(b => {
            if (b.seriesId !== bill.seriesId) return true;
            return b.paid;
        });
        saveData();
        renderAll();
        closeDeleteModal();
    });

    document.getElementById("updateThisOnly").addEventListener("click", () => {
        window._updateMode = "this";
        handleSaveBill({ preventDefault: () => { } });
    });

    document.getElementById("updateFromHere").addEventListener("click", () => {
        window._updateMode = "fromHere";
        handleSaveBill({ preventDefault: () => { } });
    });

    document.getElementById("cancelDeleteRecurring").addEventListener("click", closeDeleteModal);
    document.getElementById("closeDeleteRecurringModal").addEventListener("click", closeDeleteModal);

    document.getElementById("deleteRecurringModal").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeDeleteModal();
    });

    document.getElementById("closeAddBillModal").addEventListener("click", closeAddBillModal);

    document.getElementById("addBillModal").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeAddBillModal();
    });

    document.getElementById("closeHelpModal").addEventListener("click", () => {
        document.getElementById("helpModal").classList.remove("active");
    });

    document.getElementById("closeHelpModalX").addEventListener("click", () => {
        document.getElementById("helpModal").classList.remove("active");
    });

    document.addEventListener("keydown", (e) => {
        const isShortcut = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (isShortcut && key === "s") {
            e.preventDefault();
            exportJson();
            return;
        }

        if (isShortcut && key === "z" && !e.shiftKey) {
            e.preventDefault();
            undoChange();
            return;
        }

        if (
            (isShortcut && key === "y") ||
            (isShortcut && key === "z" && e.shiftKey)
        ) {
            e.preventDefault();
            redoChange();
        }
    }, true);

    document.addEventListener("change", (e) => {
        const field = e.target;

        if (
            field.matches("input, textarea, select") &&
            !field.readOnly &&
            !field.disabled
        ) {

            if (
                field.classList.contains("bill-name-input") ||
                field.classList.contains("bill-names-title-input") ||
                field.classList.contains("priority-name-input")
            ) {
                saveBillNames(false);
                renderCategoryOptions();
            }

            if (field === els.currencySymbol) {
                data.settings.currencySymbol = field.value;
            }

            if (field === els.currencyPosition) {
                data.settings.currencyPosition = field.value;
            }

            if (field === els.weekStart) {
                data.settings.weekStart = field.value;
                renderMiniCalendar();
                renderMiniCalendar("miniCalendarDesktop");
                renderCalendar();
            }

            if (field === els.paycheckFrequency) {
                data.paycheckSettings.frequency = field.value;
                updatePaycheckSetupVisibility();
            }

            if (field === els.paycheckStartDate) {
                data.paycheckSettings.startDate = field.value;
            }

            if (field === els.paycheckNamePrefix) {
                data.paycheckSettings.namePrefix = field.value;
            }

            if (field === els.highlightPaycheckCalendar) {
                data.paycheckSettings.highlightCalendar = field.value;
                renderCalendar();
            }

            const semiDay1El = document.getElementById("paycheckSemiDay1");
            const semiDay2El = document.getElementById("paycheckSemiDay2");
            const monthlyDayEl = document.getElementById("paycheckMonthlyDay");
            if (field === semiDay1El) {
                data.paycheckSettings.semiDay1 = parseInt(field.value) || 1;
            }
            if (field === semiDay2El) {
                data.paycheckSettings.semiDay2 = parseInt(field.value) || 15;
            }
            if (field === monthlyDayEl) {
                data.paycheckSettings.monthlyDay = parseInt(field.value) || 1;
            }

            saveData();

            if (field === els.currencySymbol || field === els.currencyPosition) {
                renderSummaryCards();
                renderListProgressBar();
                renderBills();
                renderCalendar();
                renderMonthlyInsights();
            }

            if (field === els.weekStart) {
                renderMiniCalendar();
                renderMiniCalendar("miniCalendarDesktop");
                renderCalendar();
            }
        }
    });

}

function updateRecurringFieldsVisibility() {
    const isRecurring =
        els.billFrequency.value &&
        els.billFrequency.value !== "one-time";

    els.billIntervalWrap.style.display = isRecurring ? "grid" : "none";
    els.billEndDateWrap.style.display = isRecurring ? "grid" : "none";

    if (!isRecurring) {
        els.billInterval.value = "1";
        els.billEndDate.value = "";
    }
}

function getCurrentMonthName() {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const sel = document.getElementById("insightsMonthSelect");
    if (sel) return months[parseInt(sel.value)];
    return months[currentCalendarDate.getMonth()];
}

function initYearlyYearDropdown() {
    const existing = document.getElementById("yearlyYearMenu");
    if (existing) existing.remove();

    const years = [...new Set(data.bills.map(b => parseLocalDate(getBillDisplayDate(b)).getFullYear()))].sort((a, b) => a - b);
    if (!years.includes(currentCalendarDate.getFullYear())) years.push(currentCalendarDate.getFullYear());
    years.sort((a, b) => a - b);

    const menu = document.createElement("div");
    menu.id = "yearlyYearMenu";
    menu.className = "csd-dropdown insights-year-menu";

    years.forEach(year => {
        const div = document.createElement("div");
        div.className = "csd-option" + (year === currentCalendarDate.getFullYear() ? " csd-selected" : "");
        div.textContent = year;
        div.addEventListener("click", (e) => {
            e.stopPropagation();
            currentCalendarDate = new Date(year, currentCalendarDate.getMonth(), 1);
            menu.style.display = "none";
            setRainbowTitle(String(currentCalendarDate.getFullYear()), "overview");
            renderPageHeader("yearly");
            renderYearlySummary();
        });
        menu.appendChild(div);
    });

    const caretEl = els.pageTitle.querySelector(".title-month-caret");
    if (!caretEl) return;
    const rect = caretEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${rect.left - 100}px`;
    menu.style.display = "flex";
    menu.style.flexDirection = "column";
    menu.style.maxHeight = (years.length * 44 + 12) + "px";
    document.body.appendChild(menu);

    document.addEventListener("click", () => {
        menu.style.display = "none";
    }, { once: true });
}

function initInsightsYearDropdown() {
    const existing = document.getElementById("insightsYearMenu");
    if (existing) existing.remove();
    const monthMenu = document.getElementById("insightsMonthMenu");
    if (monthMenu) monthMenu.style.display = "none";

    const years = [...new Set(data.bills.map(b => parseLocalDate(getBillDisplayDate(b)).getFullYear()))].sort((a, b) => a - b);
    if (!years.includes(currentCalendarDate.getFullYear())) years.push(currentCalendarDate.getFullYear());
    years.sort((a, b) => a - b);

    const menu = document.createElement("div");
    menu.id = "insightsYearMenu";
    menu.className = "csd-dropdown insights-year-menu";

    years.forEach(year => {
        const div = document.createElement("div");
        div.className = "csd-option" + (year === currentCalendarDate.getFullYear() ? " csd-selected" : "");
        div.textContent = year;
        div.addEventListener("click", (e) => {
            e.stopPropagation();
            currentCalendarDate = new Date(year, currentCalendarDate.getMonth(), 1);
            menu.style.display = "none";
            setRainbowTitle(getCurrentMonthName(), "insights");
            updateSectionLabel("monthly");
            renderMonthlyInsights();
            renderMonthlyNotes();
        });
        menu.appendChild(div);
    });

    const yearCaretEl = document.querySelector(".title-year-caret");
    if (!yearCaretEl) return;
    menu.style.maxHeight = "";
    const rect = yearCaretEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${rect.left - 60}px`;
    menu.style.display = "flex";
    menu.style.flexDirection = "column";
    menu.style.maxHeight = (years.length * 44 + 12) + "px";
    document.body.appendChild(menu);

    document.addEventListener("click", () => {
        menu.style.display = "none";
    }, { once: true });
}

function initInsightsMonthDropdown() {
    const existing = document.getElementById("insightsMonthMenu");
    if (existing) existing.remove();
    const yearMenu = document.getElementById("insightsYearMenu");
    if (yearMenu) yearMenu.style.display = "none";

    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

    const menu = document.createElement("div");
    menu.id = "insightsMonthMenu";
    menu.className = "csd-dropdown";
    menu.style.cssText = "position:absolute; z-index:999; min-width:140px; top:100%; left:0;";

    months.forEach((m, i) => {
        const div = document.createElement("div");
        div.className = "csd-option" + (i === currentCalendarDate.getMonth() ? " csd-selected" : "");
        div.textContent = m;
        div.addEventListener("click", (e) => {
            e.stopPropagation();
            currentCalendarDate = new Date(currentCalendarDate.getFullYear(), i, 1);
            menu.style.display = "none";
            setRainbowTitle(getCurrentMonthName(), "insights");
            updateSectionLabel("monthly");
            renderPageHeader("monthly");
            renderMonthlyInsights();
            renderMonthlyNotes();
        });
        menu.appendChild(div);
    });

    const rect = els.pageTitle.getBoundingClientRect();
    menu.className = "csd-dropdown insights-month-menu";
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${rect.left}px`;
    menu.style.display = "flex";
    document.body.appendChild(menu);

    document.addEventListener("click", () => {
        menu.style.display = "none";
    }, { once: true });
}

function setRainbowTitle(text, secondaryWord = null) {
    els.pageTitle.classList.add("rainbow-title");

    els.pageTitle.innerHTML = text
        .toLowerCase()
        .split("")
        .map(letter => letter === " " ? " " : `<span>${letter}</span>`)
        .join("");

    if (secondaryWord) {
        const secondary = document.createElement("span");
        secondary.className = "title-sacramento";
        secondary.textContent = secondaryWord;
        els.pageTitle.appendChild(secondary);
    }

    document.querySelectorAll(".title-month-caret").forEach(el => el.remove());
    if (currentActiveSection === "monthly") {
        const caret = document.createElement("span");
        caret.className = "title-month-caret";
        caret.innerHTML = `<svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg"><path d="M1 1.5L6 6.5L11 1.5" stroke="#bbb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
        els.pageTitle.insertBefore(caret, els.pageTitle.querySelector(".title-sacramento"));
        els.pageTitle.style.cursor = "pointer";
        els.pageTitle.onclick = (e) => {
            e.stopPropagation();
            const menu = document.getElementById("insightsMonthMenu");
            if (menu && menu.style.display !== "none") {
                menu.style.display = "none";
            } else {
                initInsightsMonthDropdown();
            }
        };
    } else if (currentActiveSection === "yearly") {
        const caret = document.createElement("span");
        caret.className = "title-month-caret";
        caret.innerHTML = `<svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg"><path d="M1 1.5L6 6.5L11 1.5" stroke="#bbb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
        els.pageTitle.insertBefore(caret, els.pageTitle.querySelector(".title-sacramento"));
        els.pageTitle.style.cursor = "pointer";
        els.pageTitle.onclick = (e) => {
            e.stopPropagation();
            const menu = document.getElementById("yearlyYearMenu");
            if (menu && menu.style.display !== "none") {
                menu.style.display = "none";
            } else {
                initYearlyYearDropdown();
            }
        };
    } else {
        els.pageTitle.style.cursor = "";
        els.pageTitle.onclick = null;
    }
}

function openAddBillModal() {
    if (!isActivated() && new Set(data.bills.map(b => b.seriesId)).size >= 2) {
        showActivationModal();
        return;
    }
    document.getElementById("addBillModal").classList.add("active");
    updateCurrencyInputDisplay();
    document.activeElement?.blur();
    document.getElementById("calAddBillBtn")?.classList.add("no-hover");
    setTimeout(() => document.getElementById("calAddBillBtn")?.classList.remove("no-hover"), 300);
}

function openAddBillWithDate(dateString) {
    resetForm();
    if (dateString && els.billDate) {
        els.billDate.value = dateString;
        els.billDate.classList.add("has-value");
    }
    openAddBillModal();
}

function closeAddBillModal() {
    document.getElementById("addBillModal").classList.remove("active");
    resetForm();
    if (currentActiveSection === "add") {
        localStorage.setItem("ultimatePaycheckActiveSection", "list");
        currentActiveSection = "list";
    }
}

const sectionConfig = {
    list: { main: "transaction", secondary: "list", getLabel: () => buildListLabel() },
    calendar: { main: "Calendar", secondary: "smart", getLabel: () => buildCalendarLabel() },
    monthly: { main: () => getCurrentMonthName(), secondary: "insights", getLabel: () => `${currentCalendarDate.getFullYear()} <span class="title-year-caret"><svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg"><path d="M1 1.5L6 6.5L11 1.5" stroke="#bbb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></span>` },
    paycheck: { main: "paycheck", secondary: "budget", getLabel: null },
    yearly: { main: () => String(currentCalendarDate.getFullYear()), secondary: "overview", getLabel: null },
    settings: { main: "Settings", getLabel: null },
    backup: { main: "Backup", getLabel: null },
    quickstart: { main: "quick start", secondary: "guide", getLabel: null },
    contact: { main: "contact", secondary: "us", getLabel: null },
    faq: { main: "FAQ", getLabel: null },
    accounts: { main: "accounts", secondary: "bank", getLabel: null },
    savings:  { main: "savings",  secondary: "funds", getLabel: null },
    debt:     { main: "debt",     secondary: "payments", getLabel: null },
};

function buildListLabel() {
    const statusFilter = document.getElementById("filterStatus")?.value ?? "";
    const priorityFilter = document.getElementById("filterPriority")?.value ?? "";
    const categoryFilter = document.getElementById("filterCategory")?.value ?? "";
    const monthFilter = document.getElementById("filterMonth")?.value ?? "";
    const yearFilter = document.getElementById("filterYear")?.value ?? "";

    const hasFilter = statusFilter || priorityFilter !== "" || categoryFilter || monthFilter || yearFilter;
    return hasFilter ? "Filtered Transactions" : "All Transactions";
}

function buildCalendarLabel() {
    const statusFilter = document.getElementById("calFilterStatus")?.value ?? "";
    const priorityFilter = document.getElementById("calFilterPriority")?.value ?? "";
    const categoryFilter = document.getElementById("calFilterCategory")?.value ?? "";
    const hasFilter = statusFilter || priorityFilter !== "" || categoryFilter;
    return hasFilter ? "Filtered Transactions" : "All Transactions";
}

function updateSectionLabel(section) {
    const filterLabelEl = document.getElementById("calendarFilterLabel");
    if (!filterLabelEl) return;
    const config = sectionConfig[section];
    if (config?.getLabel) {
        const labelText = config.getLabel();
        filterLabelEl.innerHTML = labelText.replace("\n", "<br>");
        filterLabelEl.classList.toggle("label-short", labelText.replace("\n", " ").length < 25);
        filterLabelEl.style.display = "block";

        if (section === "monthly") {
            const yearCaret = filterLabelEl.querySelector(".title-year-caret");
            if (yearCaret) {
                yearCaret.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const menu = document.getElementById("insightsYearMenu");
                    if (menu && menu.style.display !== "none") {
                        menu.style.display = "none";
                    } else {
                        initInsightsYearDropdown();
                    }
                });
            }
        }
    }
    else {
        filterLabelEl.textContent = "";
        filterLabelEl.style.display = "none";
    }
}

function showSection(section) {
    if (section === "add") {
        resetForm();
        if (!isActivated() && new Set(data.bills.map(b => b.seriesId)).size >= 2) {
            showActivationModal();
        } else {
            openAddBillModal();
        }
        return;
    }

    const existingIpb = document.getElementById("insightsProgressBar");
    if (existingIpb) existingIpb.remove();
    document.querySelector(".summary-grid-top")?.classList.remove("has-progress-bar");

    localStorage.setItem("ultimatePaycheckActiveSection", section);
    currentActiveSection = section;
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    document.getElementById(`section-${section}`).classList.add("active");

    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    document.querySelector(`nav button[data-section="${section}"]`).classList.add("active");

    renderPageHeader(section);

    const config = sectionConfig[section];
    document.getElementById("pageTitle").classList.remove("page-calendar", "page-list", "page-monthly", "page-yearly", "page-settings", "page-backup", "page-quickstart", "page-contact", "page-faq", "page-accounts", "page-savings", "page-debt");
    document.getElementById("pageTitle").classList.add(`page-${section}`);

    if (config && typeof config.main !== "undefined") {
        const mainText = typeof config.main === "function" ? config.main() : config.main;
        setRainbowTitle(mainText, config.secondary || null);
    } else {
        setRainbowTitle("Ultimate Paycheck");
    }

    updateSectionLabel(section);

    if (section === "list") {
        renderBills();
        if (typeof openTransactionListInfoModal === "function") openTransactionListInfoModal();
    }

    if (section === "settings") {
        renderSettings();
    }

    if (section === "calendar") {
        selectedCalDay = null;
        renderCalendar();
        if (typeof openCalendarInfoModal === "function") openCalendarInfoModal();
    }

    if (section === "paycheck") {
        renderAllPaycheck();
        if (typeof openPaycheckInfoModal === "function") openPaycheckInfoModal();
    } else {
        document.querySelectorAll(".paycheck-interval").forEach(el => el.remove());
        document.getElementById("pageTitle")?.classList.remove("page-paycheck");
    }

    if (section === "monthly") {
        renderMonthlyInsights();
        renderMonthlyNotes();
        if (typeof openMonthlyInfoModal === "function") openMonthlyInfoModal();
    }

    if (section === "yearly") {
        renderYearlySummary();
        if (typeof openYearlyInfoModal === "function") openYearlyInfoModal();
    }

    if (section === "accounts") {
        if (typeof renderAccountsPage === "function") renderAccountsPage();
        if (typeof openAccountsInfoModal === "function") openAccountsInfoModal();
    }
    if (section === "savings") {
        if (typeof renderSavingsPage === "function") renderSavingsPage();
        if (typeof openSavingsInfoModal === "function") openSavingsInfoModal();
    }
    if (section === "debt") {
        if (typeof renderDebtPage === "function") renderDebtPage();
        if (typeof openDebtsInfoModal === "function") openDebtsInfoModal();
    }
}

function renderAll() {
    const activeSection = currentActiveSection;
    renderPageHeader(activeSection);
    renderFilterOptions();
    if (activeSection === "list") renderBills();
    if (activeSection === "calendar") renderCalendar();
    if (activeSection === "monthly") renderMonthlyInsights();
    if (activeSection === "yearly") renderYearlySummary();
    if (activeSection === "settings") renderSettings();
    updateCurrencyInputDisplay();
    if (typeof renderAccountsPage === "function" && activeSection === "accounts") renderAccountsPage();
    if (typeof renderSavingsPage === "function" && activeSection === "savings") renderSavingsPage();
    if (typeof renderDebtPage === "function" && activeSection === "debt") renderDebtPage();
}

function renderAllPreservingCalPanel() {
    const panel = document.getElementById("calDayPanel");
    const wasExpanded = panel?.classList.contains("expanded");
    const shouldRestoreExpanded =
        window.innerWidth <= 550 &&
        selectedCalDay &&
        wasExpanded;

    renderAll();

    if (shouldRestoreExpanded) {
        requestAnimationFrame(() => {
            toggleCalDrawer(true);
        });
    }
}

function openTransfersInfoModal() {
    if (localStorage.getItem("ultimatePaycheckTransfersSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("transfersInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeTransfersInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckTransfersSeen", "true");
    document.getElementById("transfersInfoModal").classList.remove("active");
}

function openInvestmentsInfoModal() {
    if (localStorage.getItem("ultimatePaycheckInvestmentsSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("investmentsInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeInvestmentsInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckInvestmentsSeen", "true");
    document.getElementById("investmentsInfoModal").classList.remove("active");
}

function openCalendarInfoModal() {
    if (localStorage.getItem("ultimatePaycheckCalendarSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("calendarInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeCalendarInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckCalendarSeen", "true");
    document.getElementById("calendarInfoModal").classList.remove("active");
}

window.closeCalendarInfoModal = closeCalendarInfoModal;

function openTransactionListInfoModal() {
    if (localStorage.getItem("ultimatePaycheckTransactionListSeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("transactionListInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeTransactionListInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckTransactionListSeen", "true");
    document.getElementById("transactionListInfoModal").classList.remove("active");
}

window.closeTransactionListInfoModal = closeTransactionListInfoModal;

function openMonthlyInfoModal() {
    if (localStorage.getItem("ultimatePaycheckMonthlySeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("monthlyInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeMonthlyInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckMonthlySeen", "true");
    document.getElementById("monthlyInfoModal").classList.remove("active");
}

function openYearlyInfoModal() {
    if (localStorage.getItem("ultimatePaycheckYearlySeen") === "true") return;
    setTimeout(() => {
        const el = document.getElementById("yearlyInfoModal");
        if (el) el.classList.add("active");
    }, 50);
}

function closeYearlyInfoModal(dontShow = false) {
    if (dontShow) localStorage.setItem("ultimatePaycheckYearlySeen", "true");
    document.getElementById("yearlyInfoModal").classList.remove("active");
}

window.closeTransfersInfoModal = closeTransfersInfoModal;
window.closeInvestmentsInfoModal = closeInvestmentsInfoModal;
window.closeMonthlyInfoModal = closeMonthlyInfoModal;
window.closeYearlyInfoModal = closeYearlyInfoModal;

function renderCategoryOptions() {
    els.billCategory.innerHTML = `
        <option value="">Select category</option>
        ${data.categories
            .map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
            .join("")}
        <option value="Investments">Investments</option>
        <option value="Transfers">Transfers</option>
    `;

    const priorityNames = Array.isArray(data.priorityNames) && data.priorityNames.some(name => name.trim())
        ? data.priorityNames
        : defaultData.priorityNames;

    els.billPriority.innerHTML = `
        <option value="">Select priority</option>
        ${priorityNames
            .map((priority, index) => `<option value="${index}">${escapeHtml(priority || defaultData.priorityNames[index] || `Priority ${index + 1}`)}</option>`)
            .join("")}
    `;

    renderBillNameOptions();
}

function renderBillNameOptions() {
    const selectedCategory = els.billCategory.value;

    if (!selectedCategory) {
        els.billName.innerHTML = `<option value="">Select category first</option>`;
        return;
    }

    if (selectedCategory === "Investments") {
        els.billName.innerHTML = `<option value="Investments">Investments</option>`;
        const billNameWrap = els.billName.closest("label");
        if (billNameWrap) billNameWrap.style.display = "none";
        return;
    }

    const nameMax = window.innerWidth < 550 ? 35 : 21;

    if (isSavingsCategory(selectedCategory)) {
        const goals = (data.savingsGoals || []).filter(g => !g.archived);
        els.billName.innerHTML = goals.length
            ? `<option value="">Select fund</option>` +
              goals.map(g => `<option value="${escapeHtml(g.name)}">${escapeHtml(truncOpt(g.name, nameMax))}</option>`).join("")
            : `<option value="" disabled selected>Add savings funds in Settings</option><option value="__go_settings__">⚙ Open Settings →</option>`;
        return;
    }

    if (selectedCategory === "Debt Payments") {
        const debts = data.debts || [];
        els.billName.innerHTML = debts.length
            ? `<option value="">Select debt</option>` +
              debts.map(d => {
                  const emoji = d.type === "credit_card" ? "💳" : d.type === "loan" ? "🏦" : "📋";
                  return `<option value="${escapeHtml(d.name)}">${escapeHtml(truncOpt(emoji + ' ' + d.name, nameMax))}</option>`;
              }).join("")
            : `<option value="" disabled selected>Add debts in Settings</option><option value="__go_settings__">⚙ Open Settings →</option>`;
        return;
    }

    const group = data.billNameGroups.find(group => group.title === selectedCategory);
    const names = group?.names || [];

    els.billName.innerHTML = names.length
        ? `
            <option value="">Select transaction name</option>
            ${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(truncOpt(name, nameMax))}</option>`).join("")}
        `
        : `<option value="" disabled selected>Add names in Settings</option><option value="__go_settings__">⚙ Open Settings →</option>`;
}

function renderCustomCurrencies() {
    const addOption = els.currencySymbol.querySelector('option[value="__add_custom__"]');

    data.customCurrencies.forEach(currency => {
        if (!els.currencySymbol.querySelector(`option[value="${currency.symbol}"]`)) {
            const option = document.createElement("option");
            option.value = currency.symbol;
            option.textContent = `${currency.name} (${currency.symbol})`;
            els.currencySymbol.insertBefore(option, addOption);
        }
    });
}

function renderSettings() {
    els.currencySymbol.value = data.settings.currencySymbol;
    els.currencyPosition.value = data.settings.currencyPosition;
    els.weekStart.value = data.settings.weekStart;
    loadPaycheckSettings();
    renderAccountsCols();
    renderDebts();
    renderSavingsGoals();
    renderMenuVisibilitySettings();
}

const HIDEABLE_MENU_ITEMS = [
    { section: "quickstart", label: "Quick Start Guide" },
    { section: "contact", label: "Contact" },
    { section: "faq", label: "FAQ" }
];

function renderMenuVisibilitySettings() {
    const el = document.getElementById("menuVisibilitySettings");
    if (!el) return;
    const hidden = getHiddenMenuItems();
    el.innerHTML = HIDEABLE_MENU_ITEMS.map(item => {
        const isHidden = hidden.includes(item.section);
        return `<div class="menu-vis-row">
            <span class="menu-vis-label">${escapeHtml(item.label)}</span>
            <span class="menu-vis-right">
                <span class="menu-vis-status">${isHidden ? "Hidden" : "Visible"}</span>
                <button class="acc-link-btn" onclick="${isHidden ? "showMenuItem" : "hideMenuItem"}('${item.section}')">${isHidden ? "Show" : "Hide"}</button>
            </span>
        </div>`;
    }).join("");
}

function generateRecurringBills(bill) {
    const bills = [];
    const endOfNextYear = new Date(new Date().getFullYear() + 1, 11, 31);
    const billEndDate = bill.endDate ? parseLocalDate(bill.endDate) : null;
    const limitDate = billEndDate && billEndDate < endOfNextYear ? billEndDate : endOfNextYear;

    let current = parseLocalDate(bill.dueDate);
    let count = 0;

    while (current <= limitDate && count < 500) {
        const newBill = {
            ...bill,
            id: count === 0 ? bill.id : crypto.randomUUID(),
            dueDate: toLocalDateInputValue(current),
            paid: false,
            actualAmount: null,
            actualDate: null
        };
        bills.push(newBill);

        const next = new Date(current);
        switch (bill.frequency) {
            case "daily": next.setDate(next.getDate() + bill.interval); break;
            case "weekly": next.setDate(next.getDate() + 7 * bill.interval); break;
            case "monthly": { const _day1814 = next.getDate(); next.setDate(1); next.setMonth(next.getMonth() + bill.interval); next.setDate(Math.min(_day1814, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())); break; }
            case "yearly": next.setFullYear(next.getFullYear() + bill.interval); break;
        }
        current = next;
        count++;
    }

    return bills;
}

function isActivated() {
    return localStorage.getItem("ultimatePaycheckActivated") === "true";
}

function getHiddenMenuItems() {
    try {
        const parsed = JSON.parse(localStorage.getItem("ultimatePaycheckHiddenMenuItems") || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function applyHiddenMenuItems() {
    const hidden = getHiddenMenuItems();
    document.querySelectorAll("nav button[data-section]").forEach(btn => {
        btn.style.display = hidden.includes(btn.dataset.section) ? "none" : "";
    });
}

function hideMenuItem(section) {
    const hidden = getHiddenMenuItems();
    if (!hidden.includes(section)) hidden.push(section);
    localStorage.setItem("ultimatePaycheckHiddenMenuItems", JSON.stringify(hidden));
    applyHiddenMenuItems();
    if (currentActiveSection === section) showSection("list");
    if (typeof renderSettings === "function") renderSettings();
}

function showMenuItem(section) {
    const hidden = getHiddenMenuItems().filter(s => s !== section);
    localStorage.setItem("ultimatePaycheckHiddenMenuItems", JSON.stringify(hidden));
    applyHiddenMenuItems();
    if (typeof renderSettings === "function") renderSettings();
}
window.hideMenuItem = hideMenuItem;
window.showMenuItem = showMenuItem;

function showActivationModal() {
    document.getElementById("activationCodeInput").value = "";
    document.getElementById("activationError").style.display = "none";
    document.getElementById("activationModal").classList.add("active");
}

function toggleBackupGuide() {
  const body = document.getElementById('backupGuideBody');
  const chevron = document.getElementById('backupGuideChevron');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chevron.classList.toggle('open', !isOpen);
}

function toggleFaqItem(btn) {
  const body = btn.nextElementSibling;
  const chevron = btn.querySelector('.backup-guide-chevron');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chevron.classList.toggle('open', !isOpen);
}

function closeActivationModal() {
    document.getElementById("activationModal").classList.remove("active");
    if (currentActiveSection === "add") {
        localStorage.setItem("ultimatePaycheckActiveSection", "list");
        currentActiveSection = "list";
    }
}

function submitActivationCode() {
    const input = document.getElementById("activationCodeInput");
    const error = document.getElementById("activationError");
    const code = input.value.trim();
    if (code === "H9RMVTXK3W") {
        localStorage.setItem("ultimatePaycheckActivated", "true");
        closeActivationModal();
        const menuActivation = document.getElementById("menuActivation");
        if (menuActivation) menuActivation.style.display = "none";
    } else {
        error.style.display = "block";
        input.value = "";
        input.focus();
    }
}

window.closeActivationModal = closeActivationModal;
window.submitActivationCode = submitActivationCode;

function handleSaveBill(event) {
    event.preventDefault();

    const addAnother = window._saveAndAdd;
    window._saveAndAdd = false;
    const markPaid = window._saveAndMarkPaid;
    window._saveAndMarkPaid = false;
    const existing = els.editingId.value
        ? data.bills.find(b => b.id === els.editingId.value)
        : null;

    const id = els.editingId.value || crypto.randomUUID();

    const category = existing ? existing.category : els.billCategory.value;
    const isDebtPayment = category === "Debt Payments";

    let amount, actualAmount, debtPrincipal, debtInterest, actualDebtPrincipal, actualDebtInterest;
    if (isDebtPayment) {
        // Principal/Interest are the locked planned split (like Amount) — set once, never
        // re-derived. Actual Principal/Interest are the real override (like Actual Amount);
        // amount/actualAmount stay as derived totals for every generic amount-reading path.
        debtPrincipal = existing ? (existing.debtPrincipal ?? 0) : (Number(els.billAmount.value) || 0);
        debtInterest = existing ? (existing.debtInterest ?? 0) : (Number(els.billInterest.value) || 0);
        const paidPrincipalRaw = els.billPaidAmount.value;
        const paidInterestRaw = els.billPaidInterest.value;
        const hasOverride = paidPrincipalRaw !== "" || paidInterestRaw !== "";
        actualDebtPrincipal = paidPrincipalRaw !== "" ? Number(paidPrincipalRaw) : null;
        actualDebtInterest = paidInterestRaw !== "" ? Number(paidInterestRaw) : null;
        amount = debtPrincipal + debtInterest;
        actualAmount = hasOverride
            ? (actualDebtPrincipal ?? debtPrincipal) + (actualDebtInterest ?? debtInterest)
            : null;
    } else {
        amount = Number(els.billAmount.value);
        actualAmount = els.billPaidAmount.value !== "" ? Number(els.billPaidAmount.value) : null;
        debtPrincipal = existing ? (existing.debtPrincipal ?? null) : null;
        debtInterest = existing ? (existing.debtInterest ?? null) : null;
        actualDebtPrincipal = existing ? (existing.actualDebtPrincipal ?? null) : null;
        actualDebtInterest = existing ? (existing.actualDebtInterest ?? null) : null;
    }

    const bill = {
        id,
        seriesId: existing?.seriesId || id,
        name: existing ? existing.name : (els.billCategory.value === "Transfers"
            ? (() => {
                const fromId = document.getElementById("billFrom")?.value || "";
                const toId = document.getElementById("billTo")?.value || "";
                const fromAcc = data.accounts.find(a => a.id === fromId);
                const toAcc = data.accounts.find(a => a.id === toId);
                return `Account Transfer`;
            })()
            : els.billName.value.trim()),
        category,
        type: existing ? existing.type : els.billType.value,
        amount,
        actualAmount,
        dueDate: existing ? existing.dueDate : els.billDate.value,
        actualDate: els.billPaidDate.value !== "" ? els.billPaidDate.value : null,
        priority: Number(els.billPriority.value),
        frequency: existing ? existing.frequency : els.billFrequency.value,
        interval: existing ? existing.interval : (Number(els.billInterval.value) || 1),
        endDate: els.billEndDate.value || null,
        notes: els.billNotes.value.trim(),
        paid: existing ? existing.paid : false,
        fromAccount: (document.getElementById("billFromWrap")?.style.display !== "none") ? (document.getElementById("billFrom")?.value || null) : null,
        toAccount: (document.getElementById("billToWrap")?.style.display !== "none") ? (document.getElementById("billTo")?.value || null) : null,
        debtId: existing
            ? (existing.debtId ?? null)
            : (els.billCategory.value === "Debt Payments"
                ? ((data.debts || []).find(d => d.name === els.billName.value.trim())?.id ?? null)
                : null),
        debtGenerated: existing ? (existing.debtGenerated ?? false) : false,
        debtPrincipal,
        debtInterest,
        actualDebtPrincipal,
        actualDebtInterest
    };

    const fromVisible = document.getElementById("billFromWrap")?.style.display !== "none";
    const toVisible = document.getElementById("billToWrap")?.style.display !== "none";

    const validationFields = [
        { elId: "billCategory", valid: () => els.billCategory.value !== "" },
        { elId: "billName", valid: () => els.billCategory.value === "Transfers" || els.billName.value !== "" },
        { elId: "billType", valid: () => els.billCategory.value === "Transfers" || els.billType.value !== "" },
        { elId: "billAmount", valid: () => els.billAmount.value !== "" && Number(els.billAmount.value) >= 0 },
        { elId: "billDate", valid: () => els.billDate.value !== "" || (!!els.editingId.value && !!data.bills.find(b => b.id === els.editingId.value)?.dueDate) },
        { elId: "billPriority", valid: () => els.billPriority.required === false || els.billPriority.value !== "" },
        { elId: "billFrequency", valid: () => els.billFrequency.value !== "" },
        { elId: "billFrom", valid: () => !fromVisible || document.getElementById("billFrom")?.value !== "" },
        { elId: "billTo", valid: () => !toVisible || document.getElementById("billTo")?.value !== "" }
    ];

    // Curăță erorile anterioare
    validationFields.forEach(f => {
        const el = document.getElementById(f.elId);
        if (!el) return;
        const wrapper = el.closest(".csd-wrapper");
        if (wrapper) wrapper.classList.remove("field-error");
        el.classList.remove("field-error");
    });

    const invalidFields = validationFields.filter(f => !f.valid());
    if (invalidFields.length > 0) {
        // Marchează toate câmpurile invalide
        invalidFields.forEach(f => {
            const el = document.getElementById(f.elId);
            if (!el) return;
            const wrapper = el.closest(".csd-wrapper");
            if (wrapper) wrapper.classList.add("field-error");
            else el.classList.add("field-error");
        });

        // Focus + tooltip pe primul invalid
        const firstEl = document.getElementById(invalidFields[0].elId);
        if (firstEl) {
            const wrapper = firstEl.closest(".csd-wrapper");
            const trigger = wrapper ? wrapper.querySelector(".csd-trigger") : null;
            const anchor = trigger || firstEl;
            if (trigger) trigger.focus();
            else firstEl.focus();

            // Tooltip "Please fill out this field."
            const existing = document.getElementById("_validationTooltip");
            if (existing) existing.remove();

            const tip = document.createElement("div");
            tip.id = "_validationTooltip";
            tip.textContent = "Please fill out this field.";
            document.body.appendChild(tip);

            const rect = anchor.getBoundingClientRect();
            tip.style.left = (rect.left + window.scrollX) + "px";
            tip.style.top = (rect.bottom + window.scrollY + 6) + "px";

            setTimeout(() => tip.remove(), 2500);
        }
        return;
    }

    if (bill.frequency === "one-time") {
        bill.interval = 1;
        bill.endDate = null;
    }

    if (els.editingId.value) {
        if (bill.frequency !== "one-time") {
            const updateMode = window._updateMode || "this";
            window._updateMode = null;

            if (updateMode === "fromHere") {
                const fromDate = parseLocalDate(existing.dueDate);
                data.bills = data.bills.map(b => {
                    if (b.seriesId !== bill.seriesId) return b;
                    if (b.paid) return b;
                    if (parseLocalDate(b.dueDate) < fromDate) return b;
                    if (b.id === bill.id) return { ...b, actualAmount: bill.actualAmount, actualDate: bill.actualDate, priority: bill.priority, notes: bill.notes };
                    return { ...b, actualAmount: bill.actualAmount, priority: bill.priority, notes: bill.notes };
                });
            } else {
                // Actualizează doar instanța curentă
                data.bills = data.bills.map(b => b.id === bill.id ? bill : b);
            }

            // Dacă end date s-a schimbat
            if (bill.endDate) {
                // Propagă end date la toate instanțele din serie
                data.bills = data.bills.map(b =>
                    b.seriesId === bill.seriesId ? { ...b, endDate: bill.endDate } : b
                );
                // Curăță instanțele unpaid după noul end date
                const endLimit = parseLocalDate(bill.endDate);
                data.bills = data.bills.filter(b => {
                    if (b.seriesId !== bill.seriesId) return true;
                    if (b.paid) return true;
                    return parseLocalDate(b.dueDate) <= endLimit;
                });
                // Regenerează instanțele lipsă până la noul end date
                const existingDates = new Set(
                    data.bills
                        .filter(b => b.seriesId === bill.seriesId)
                        .map(b => b.dueDate)
                );
                const generated = generateRecurringBills(bill);
                const missing = generated.filter(b => !existingDates.has(b.dueDate));
                data.bills.push(...missing);
            } else {
                // End date șters — regenerează instanțele lipsă până la sfârșitul anului următor
                const existingDates = new Set(
                    data.bills
                        .filter(b => b.seriesId === bill.seriesId)
                        .map(b => b.dueDate)
                );
                const generated = generateRecurringBills(bill);
                const missing = generated.filter(b => !existingDates.has(b.dueDate));
                data.bills.push(...missing);
            }
        } else {
            data.bills = data.bills.map(b => b.id === bill.id ? bill : b);
        }
    } else {
        if (!isActivated() && new Set(data.bills.map(b => b.seriesId)).size >= 2) {
            closeAddBillModal();
            showActivationModal();
            return;
        }

        if (bill.frequency === "one-time") {
            data.bills.push(bill);
        } else {
            const generated = generateRecurringBills(bill);
            data.bills.push(...generated);
        }
    }

    sortBills(data.bills);

    if (markPaid) {
        data.bills = data.bills.map(b =>
            b.seriesId === bill.seriesId && b.id === bill.id ? { ...b, paid: true } : b
        );
    }

    if (window._saveAndMarkPaidEdit) {
        const editId = window._saveAndMarkPaidEdit;
        window._saveAndMarkPaidEdit = null;
        data.bills = data.bills.map(b =>
            b.id === editId ? { ...b, paid: !b.paid } : b
        );
    }

    saveData();
    renderAllPreservingCalPanel();
    resetForm();
    if (addAnother) {
        // rămâne deschis
    } else {
        closeAddBillModal();
    }
}

function resetForm() {
    window._saveAndPaidEditFn = null;
    els.billForm.reset();
    document.querySelectorAll(".csd-wrapper.field-error, .field-error").forEach(el => el.classList.remove("field-error"));
    const msg = document.getElementById("billFormErrorMsg");
    if (msg) msg.textContent = "";
    els.billDate.classList.remove("has-value");
    els.billPaidDate.classList.remove("has-value");
    els.editingId.value = "";
    els.saveBillBtn.textContent = "Save";
    els.saveBillBtn.classList.remove("update-mode");
    els.cancelEditBtn.style.display = "none";
    els.billCategory.disabled = false;
    els.billName.disabled = false;
    els.billType.disabled = false;
    els.billFrequency.disabled = false;
    els.billInterval.disabled = false;
    els.billDate.disabled = false;
    els.billAmount.disabled = false;
    if (els.billInterest) els.billInterest.disabled = false;
    ["billCategory", "billName", "billType", "billFrequency"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.closest(".csd-wrapper")?.classList.remove("csd-disabled");
    });
    resetHelpTexts();
    els.billPaidAmountWrap.style.display = "none";
    els.billPaidDateWrap.style.display = "none";
    if (els.billInterestWrap) els.billInterestWrap.style.display = "none";
    if (els.billPaidInterestWrap) els.billPaidInterestWrap.style.display = "none";
    if (els.billPaidInterest) els.billPaidInterest.style.color = "";
    els.billPaidAmount.style.color = "";
    renderCategoryOptions();
    updateRecurringFieldsVisibility();
    document.getElementById("addBillModalTitle").innerHTML = "<span class=\"help-icon\" data-help-title=\"Adding a transaction\" data-help=\"Add one-time or recurring transactions.&lt;br&gt;&lt;br&gt;Each field has its own icon with more details.\" style=\"cursor:pointer; margin-right:6px;\">📋</span>Add a transaction";
    document.getElementById("saveAndAddBtn").style.removeProperty("display");
    els.saveBillBtn.style.display = "";
    els.saveBillBtn.classList.remove("update-mode");
    document.getElementById("updateThisOnly").style.display = "none";
    document.getElementById("updateFromHere").style.display = "none";

    const saveAndPaidBtn = document.getElementById("saveAndPaidBtn");
    saveAndPaidBtn.textContent = "Save & Mark Paid";
    saveAndPaidBtn.classList.remove("btn-orange");
    saveAndPaidBtn.classList.add("btn-green");
     updateTypeOptions();
    const billNameWrap = els.billName.closest("label");
    const billTypeWrap = els.billType.closest("label");
    if (billNameWrap) billNameWrap.style.display = "";
    if (billTypeWrap) billTypeWrap.style.display = "";
    const fromEl = document.getElementById("billFrom");
    const toEl = document.getElementById("billTo");
    if (fromEl) fromEl.innerHTML = "";
    if (toEl) toEl.innerHTML = "";
    const fromWrap = document.getElementById("billFromWrap");
    const toWrap = document.getElementById("billToWrap");
    if (fromWrap) fromWrap.style.display = "none";
    if (toWrap) toWrap.style.display = "none";
    updatePaidLabels();
    const svHint = document.getElementById("svAmountHint");
    if (svHint) svHint.style.display = "none";
    svAmountPreFilled = false;
    const svEdHint = document.getElementById("svEndDateHint");
    if (svEdHint) svEdHint.style.display = "none";
}

function setEditHelpTexts(isRecurring) {
    const helpTexts = {
        billCategory: "This field cannot be changed after a transaction is created. To use a different category, delete this transaction and create a new one.",
        billName: "This field cannot be changed after a transaction is created. To use a different name, delete this transaction and create a new one.",
        billType: "This field cannot be changed after a transaction is created. To use a different type, delete this transaction and create a new one.",
        billAmount: "This is the planned amount set when the transaction was created. It cannot be changed. If the actual amount paid differs, enter it in Paid Amount below.",
        billName: "This field cannot be changed after a bill is created. To use a different name, delete this bill and create a new one.",
        billType: "This field cannot be changed after a bill is created. To use a different type, delete this bill and create a new one.",
        billAmount: "This is the planned amount set when the bill was created. It cannot be changed. If the actual amount paid differs, enter it in Paid Amount below.",
        billDate: "This is the original due date and cannot be changed. If the actual payment date differs, enter it in Paid Date below.",
        billFrequency: "This field cannot be changed after a bill is created. To change the frequency, close this series with an End Date and create a new bill.",
        billInterval: "This field cannot be changed after a bill is created. To change the interval, close this series with an End Date and create a new bill."
    };

    Object.entries(helpTexts).forEach(([id, text]) => {
        const input = document.getElementById(id);
        if (!input) return;
        const label = input.closest("label");
        if (!label) return;
        const span = label.querySelector(".help-icon");
        if (!span) return;
        span.dataset.help = text;
    });
}

function resetHelpTexts() {
    const helpTexts = {
        billCategory: "💰 <strong>Income</strong> — salary, freelance, any earnings. Use <em>Received</em> for incoming payments and <em>Returned</em> for money you paid back.<br><br>🐷 <strong>Savings</strong> — money you set aside for the future. Use <em>Deposit</em> when you move money into savings, and <em>Withdrawal</em> when you take it back out. Reduces your left-to-spend balance.<br><br>🏠 <strong>Bills</strong> — regular fixed payments: rent, subscriptions, insurance, utilities.<br><br>🛒 <strong>Expenses</strong> — variable day-to-day spending: groceries, dining out, fuel, shopping.<br><br>⚠️ Any payment made with a <strong>credit card</strong> is <strong>not deducted</strong> from your left-to-spend — it appears in your category totals but doesn't affect your available cash. You can track this in the <strong>Monthly Insights</strong> and <strong>Paycheck Budget</strong> pages.<br><br>💳 <strong>Debt Payments</strong> — payments toward a debt. Set up your debts in Settings first. Keeps debt tracking accurate and separate from regular expenses.<br><br>📈 <strong>Investments</strong><br>Use this category to record money you're moving into or out of an investment account — for example, buying stocks, funding a portfolio, or withdrawing from an investment platform.<br><br><strong>What it does:</strong><br>• Deposits reduce your left-to-spend balance, just like an expense would.<br>• Withdrawals add back to your left-to-spend balance.<br><br><strong>What it doesn't do:</strong><br>This category does not track your investment performance, portfolio value, or returns. It only records the cash movement in and out of your investment account.<br><br><strong>Coming in the Ultimate version:</strong><br>The Ultimate Paycheck Budget App will include a dedicated Investments page with full portfolio tracking, category breakdowns, and a separate dashboard.<br><br>🔄 <strong>Transfers</strong><br>A Transfer moves money between your everyday accounts — for example, from your bank account to your wallet, or from one bank account to another.<br><br><strong>What Transfers are NOT for:</strong><br>• <strong>Savings deposits or withdrawals</strong> — use the Savings category instead. This keeps your savings balance and your budget in sync.<br>• <strong>Investment deposits or withdrawals</strong> — use the Investments category instead, for the same reason.<br>• <strong>Paying off a credit card debt</strong> — use Debt Payments for that. Transfers to a credit card are only for moving money you already have, not for repaying a loan or credit balance.<br><br><strong>Why don't I see my Savings or Investment accounts here?</strong><br>Savings and Investment accounts are intentionally excluded from Transfers. Moving money into them through a Transfer would update the account balance but not your budget — your left-to-spend wouldn't change, and your categories wouldn't reflect the movement. Always use the correct category to keep everything in sync.",
        billName: "Select the transaction name from the dropdown. Transaction names are managed in the Settings page.",
        billType: "Select Payment for regular transactions and expenses. Select Refund for reimbursements or returned payments.",
        billAmount: "Enter the amount you're planning for this transaction. Always enter a positive number — the transaction type (Received, Returned, Deposit, Withdrawal, Payment, etc.) determines the direction of the money.<br><br>Making a partial or extra payment toward something you already planned? Enter <strong>0</strong> here instead of a new planned amount — a \"New/Paid Amount\" field will appear for the real amount, without inflating your planned total.<br><br>Wasn't planned at all? Enter <strong>0</strong> here too — put the real amount in New/Paid Amount below instead of guessing a planned figure.<br><br>Once a real payment is recorded, this field locks — it stays as your original plan; only the New/Paid Amount can change from then on.",
        billFrequency: "Select how often this transaction repeats. Choose One-time for a single payment, or Daily, Weekly, Monthly, Yearly for recurring transactions. If you select a recurring frequency, Interval and End Date fields will appear.",
        billDate: "Enter the transaction's due date. For recurring transactions, this is the first due date — the recurring series starts from this date. This date is used to organize and calculate expected amounts across all reports.",
        billFrequency: "Select how often this transaction repeats. Choose One-time for a single payment, or Daily, Weekly, Monthly, Yearly for recurring transactions. If you select a recurring frequency, Interval and End Date fields will appear.",
        billInterval: "Enter a number that sets how often the transaction repeats based on the selected Frequency. 1 = every unit, 2 = every 2 units, and so on. The Due Date is always the starting point."
    };

    Object.entries(helpTexts).forEach(([id, text]) => {
        const input = document.getElementById(id);
        if (!input) return;
        const label = input.closest("label");
        if (!label) return;
        const span = label.querySelector(".help-icon");
        if (!span) return;
        span.dataset.help = text;
    });
}

function editBill(id) {
    const bill = data.bills.find(b => b.id === id);
    if (!bill) return;

    const isRecurring = bill.frequency !== "one-time";

    els.editingId.value = bill.id;
    els.billCategory.value = bill.category;
    renderBillNameOptions();
    updateTypeOptions(bill.type);
    updatePaidLabels();
    els.billName.value = bill.name;
    els.billType.value = bill.type;
    const isDebtPaymentBill = bill.category === "Debt Payments";
    els.billAmount.value = isDebtPaymentBill
        ? Number(bill.debtPrincipal ?? 0).toFixed(2)
        : Number(bill.amount).toFixed(2);
    els.billDate.value = bill.dueDate;
    els.billPriority.value = bill.priority;
    els.billFrequency.value = bill.frequency;
    els.billInterval.value = bill.interval || 1;
    els.billEndDate.value = bill.endDate || "";
    els.billNotes.value = bill.notes || "";
    const fromEl = document.getElementById("billFrom");
    const toEl = document.getElementById("billTo");
    if (fromEl) { fromEl.innerHTML = getAccountOptions(bill.category, bill.type, "from"); fromEl.value = bill.fromAccount || ""; }
    if (toEl) { toEl.innerHTML = getAccountOptions(bill.category, bill.type, "to"); toEl.value = bill.toAccount || ""; }
    if (isDebtPaymentBill) {
        updateDebtPaymentAccounts();
        if (fromEl) fromEl.value = bill.fromAccount || "";
        if (els.billInterestWrap) els.billInterestWrap.style.display = "";
        if (els.billInterest) els.billInterest.value = Number(bill.debtInterest ?? 0).toFixed(2);
        if (els.billPaidInterestWrap) els.billPaidInterestWrap.style.display = "";
    }

    els.billPaidAmountWrap.style.display = "";
    els.billPaidDateWrap.style.display = "";
    const freqLabel = els.billFrequency.closest("label");
    freqLabel.classList.remove("grid-row-break");
    if (isDebtPaymentBill) {
        els.billPaidAmount.value = bill.actualDebtPrincipal != null ? Number(bill.actualDebtPrincipal).toFixed(2) : "";
        if (els.billPaidInterest) els.billPaidInterest.value = bill.actualDebtInterest != null ? Number(bill.actualDebtInterest).toFixed(2) : "";
        els.billPaidAmount.style.color = bill.actualDebtPrincipal != null ? "var(--text)" : "";
        if (els.billPaidInterest) els.billPaidInterest.style.color = bill.actualDebtInterest != null ? "var(--text)" : "";
    } else {
        els.billPaidAmount.value = bill.actualAmount != null ? Number(bill.actualAmount).toFixed(2) : "";
        els.billPaidAmount.style.color = bill.actualAmount != null ? "var(--text)" : "";
    }
    els.billPaidDate.value = bill.actualDate || "";
    els.billPaidDate.classList.toggle("has-value", !!bill.actualDate);
    els.billPaidDate.addEventListener("change", () => {
        document.getElementById("updateFromHere").style.display = (els.billPaidDate.value || !isRecurring) ? "none" : "";
    });

    updateRecurringFieldsVisibility();
    setEditHelpTexts(isRecurring);

    // Blochează câmpurile care nu se pot edita
    els.billCategory.disabled = true;
    els.billName.disabled = true;
    els.billType.disabled = true;
    els.billFrequency.disabled = true;
    els.billInterval.disabled = true;
    els.billAmount.disabled = true;
    if (els.billInterest) els.billInterest.disabled = true;
    ["billCategory", "billName", "billType", "billFrequency"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.closest(".csd-wrapper")?.classList.add("csd-disabled");
    });
    if (!isRecurring) {
        els.billDate.disabled = true;
        document.getElementById("saveAndAddBtn").style.display = "none";
    } else {
        els.billDate.disabled = true;
    }

    document.getElementById("addBillModalTitle").innerHTML = isRecurring ? "<span class=\"help-icon\" data-help-title=\"Editing a recurring transaction\" data-help=\"Here you can update the amount, priority, end date and notes.&lt;br&gt;&lt;br&gt;Category, Name, Type, Frequency and Interval cannot be changed after a transaction is created.&lt;br&gt;&lt;br&gt;If you need to change the frequency or interval, close this series with an End Date and create a new transaction with the correct settings.\" style=\"cursor:pointer; margin-right:6px;\">✏️</span>Edit transaction" : "<span class=\"help-icon\" data-help-title=\"Editing a one-time transaction\" data-help=\"Here you can update the amount, due date, priority and notes.&lt;br&gt;&lt;br&gt;Category, Name, Type and Frequency cannot be changed after a transaction is created.\" style=\"cursor:pointer; margin-right:6px;\">✏️</span>Edit transaction";
    document.getElementById("saveAndAddBtn").style.display = "none";

    const saveAndPaidBtn = document.getElementById("saveAndPaidBtn");
    saveAndPaidBtn.style.display = "";
    if (bill.paid) {
        saveAndPaidBtn.textContent = `Update & ${getMarkUnpaidLabel(bill)}`;
        saveAndPaidBtn.classList.remove("btn-green");
        saveAndPaidBtn.classList.add("btn-orange");
    } else {
        saveAndPaidBtn.textContent = `Update & ${getMarkPaidLabel(bill)}`;
        saveAndPaidBtn.classList.remove("btn-orange");
        saveAndPaidBtn.classList.add("btn-green");
    }
    window._saveAndPaidEditFn = () => {
        window._saveAndMarkPaidEdit = bill.id;
        els.saveBillBtn.click();
    };

    if (isRecurring) {
        els.saveBillBtn.style.display = "none";
        els.saveBillBtn.classList.remove("update-mode");
        document.getElementById("updateThisOnly").style.display = "";
        document.getElementById("updateFromHere").style.display = "";
    } else {
        els.saveBillBtn.textContent = "Update Transaction";
        els.saveBillBtn.classList.add("update-mode");
        els.saveBillBtn.style.display = "";
        document.getElementById("updateThisOnly").style.display = "none";
        document.getElementById("updateFromHere").style.display = "none";
    }

    openAddBillModal();
}

function deleteBill(id) {
    const bill = data.bills.find(b => b.id === id);
    if (!bill) return;

    if (bill.frequency === "one-time") {
        if (!confirm("Delete this transaction?")) return;
        data.bills = data.bills.filter(b => b.id !== id);
        saveData();
        renderAll();
        return;
    }

    // Recurent — deschide modalul
    window._deletingBillId = id;
    document.getElementById("deleteRecurringModal").classList.add("active");
}

function getPaidLabel(bill) {
    if (bill.type === "interest" && isSavingsCategory(bill.category)) return "Earned";
    if (bill.type === "refund") {
        if (isSavingsCategory(bill.category)) return "Withdrawn";
        if (bill.category === "Investments") return "Withdrawn";
        if (isIncomeCategory(bill.category)) return "Returned";
        return "Received";
    }
    if (isIncomeCategory(bill.category)) return "Received";
    if (isSavingsCategory(bill.category)) return "Saved";
    if (bill.category === "Investments") return "Invested";
    if (bill.category === "Transfers") return "Done";
    return "Paid";
}

function getUnpaidLabel(bill) {
    if (bill.type === "interest" && isSavingsCategory(bill.category)) return "Not Earned";
    if (bill.type === "refund") {
        if (isSavingsCategory(bill.category)) return "Not Withdrawn";
        if (bill.category === "Investments") return "Not Withdrawn";
        if (isIncomeCategory(bill.category)) return "Not Returned";
        return "Not Received";
    }
    if (isIncomeCategory(bill.category)) return "Not Received";
    if (isSavingsCategory(bill.category)) return "Not Saved";
    if (bill.category === "Investments") return "Not Invested";
    if (bill.category === "Transfers") return "Undone";
    return "Unpaid";
}

function isFromCreditAccount(bill) {
    if (!bill.fromAccount) return false;
    const acc = (data.accounts || []).find(a => a.id === bill.fromAccount);
    return acc?.type === "credit";
}

function calcAutoRollover(beforeDate) {
    const spendingCats = data.categories.slice(2);
    const getAmt = b => b.type === "refund"
        ? -(parseFloat(getBillDisplayAmount(b)) || 0)
        :  (parseFloat(getBillDisplayAmount(b)) || 0);
    const bills = (data.bills || []).filter(b => {
        if (!b.paid) return false;
        const d = parseLocalDate(getBillDisplayDate(b));
        return d < beforeDate;
    });
    const startBalances = (data.accounts || [])
        .filter(a => a.type === "bank" || a.type === "cash")
        .reduce((s, a) => s + (parseFloat(a.startBalance) || 0), 0);
    const income      = bills.filter(b => b.category === data.categories[0]).reduce((s, b) => s + getAmt(b), 0);
    const savings     = bills.filter(b => b.category === data.categories[1] && b.type !== "interest").reduce((s, b) => s + getAmt(b), 0);
    const cashSpent   = bills.filter(b => spendingCats.includes(b.category) && !isFromCreditAccount(b)).reduce((s, b) => s + getAmt(b), 0);
    const investments = bills.filter(b => b.category === "Investments").reduce((s, b) => s + getAmt(b), 0);
    return startBalances + income - savings - cashSpent - investments;
}

function updateBillPaidAmountVisibility() {
    const isZero = els.billAmount.value !== "" && Number(els.billAmount.value) === 0;
    els.billPaidAmountWrap.style.display = isZero ? "" : "none";
    if (els.billPaidInterestWrap) els.billPaidInterestWrap.style.display = isZero ? "" : "none";
}

function updatePaidLabels() {
    const category = els.billCategory.value;
    const type = els.billType.value;
    const amountLabel = document.getElementById("paidAmountLabel");
    const dateLabel = document.getElementById("paidDateLabel");
    const amountHelpIcon = document.getElementById("paidAmountHelpIcon");
    const dateHelpIcon = document.getElementById("paidDateHelpIcon");
    const billAmountLabel = document.getElementById("billAmountLabel");
    const billAmountHelpIcon = document.getElementById("billAmountHelpIcon");

    const isDebtPayment = category === "Debt Payments";
    if (els.billInterestWrap) els.billInterestWrap.style.display = isDebtPayment ? "" : "none";
    if (billAmountLabel) billAmountLabel.textContent = isDebtPayment ? "Principal" : "Planned Amount";
    if (billAmountHelpIcon) billAmountHelpIcon.setAttribute("data-help-title", isDebtPayment ? "💳 Principal" : "💰 Planned Amount");
    if (billAmountHelpIcon) billAmountHelpIcon.setAttribute("data-help", isDebtPayment
        ? "The planned portion of this payment that reduces what you owe — the rest is Interest. Once a real payment is recorded, this field locks; only New Principal below can change from then on."
        : "Enter the amount you're planning for this transaction. Always enter a positive number — the transaction type (Received, Returned, Deposit, Withdrawal, Payment, etc.) determines the direction of the money.&lt;br&gt;&lt;br&gt;Making a partial or extra payment toward something you already planned? Enter &lt;strong&gt;0&lt;/strong&gt; here instead of a new planned amount — a &quot;New/Paid Amount&quot; field will appear for the real amount, without inflating your planned total.&lt;br&gt;&lt;br&gt;Wasn't planned at all? Enter &lt;strong&gt;0&lt;/strong&gt; here too — put the real amount in New/Paid Amount below instead of guessing a planned figure.&lt;br&gt;&lt;br&gt;Once a real payment is recorded, this field locks — it stays as your original plan; only the New/Paid Amount can change from then on.");

    let amountText = "New/Paid Amount";
    let dateText = "New/Paid Date";
    let amountHelp = "Enter a New/Paid Amount if the actual paid amount differs from the planned Amount. If Planned Amount is 0, enter the real amount of an unplanned transaction here.";
    let dateHelp = "Enter a New/Paid Date if the actual payment date differs from the original Due Date.";

    if (isDebtPayment) {
        amountText = "New Principal";
        amountHelp = "Enter the real principal paid if it differs from the plan — for example, you paid extra toward the balance. Only this reduces what you owe.";
        dateText = "New/Paid Date";
        dateHelp = "Enter a New/Paid Date if the actual payment date differs from the original Due Date.";
    } else if (isIncomeCategory(category)) {
        if (type === "payment") {
            amountText = "New/Received Amount";
            amountHelp = "Enter a New/Received Amount if the actual received amount differs from the planned Amount. If Planned Amount is 0, enter the real amount of an unplanned transaction here.";
        } else {
            amountText = "New/Returned Amount";
            amountHelp = "Enter a New/Returned Amount if the actual returned amount differs from the planned Amount. If Planned Amount is 0, enter the real amount of an unplanned transaction here.";
        }
        dateText = "New/Actual Date";
        dateHelp = "Enter the actual date if it differs from the original Due Date.";
    } else if (isSavingsCategory(category)) {
        if (type === "payment") {
            amountText = "New/Saved Amount";
            amountHelp = "Enter a New/Saved Amount if the actual saved amount differs from the planned Amount. If Planned Amount is 0, enter the real amount of an unplanned transaction here.";
        } else if (type === "interest") {
            amountText = "Interest Amount";
            amountHelp = "Enter the interest amount earned on this fund.";
        } else {
            amountText = "New/Withdrawn Amount";
            amountHelp = "Enter a New/Withdrawn Amount if the actual withdrawn amount differs from the planned Amount. If Planned Amount is 0, enter the real amount of an unplanned transaction here.";
        }
        dateText = "New/Actual Date";
        dateHelp = "Enter the actual date if it differs from the original Due Date.";
    } else if (type === "refund") {
        amountText = "New/Received Amount";
        dateText = "New/Actual Date";
        amountHelp = "Enter a New/Received Amount if the actual received amount differs from the planned Amount. If Planned Amount is 0, enter the real amount of an unplanned transaction here.";
        dateHelp = "Enter the actual date if it differs from the original Due Date.";
    }

    if (amountLabel) amountLabel.textContent = amountText;
    if (dateLabel) dateLabel.textContent = dateText;
    if (amountHelpIcon) amountHelpIcon.setAttribute("data-help-title", `💰 ${amountText}`);
    if (amountHelpIcon) amountHelpIcon.setAttribute("data-help", amountHelp);
    if (dateHelpIcon) dateHelpIcon.setAttribute("data-help-title", `🗓️ ${dateText}`);
    if (dateHelpIcon) dateHelpIcon.setAttribute("data-help", dateHelp);
}

function renderPriorityOptions() {
    const priorityNames = Array.isArray(data.priorityNames) && data.priorityNames.some(name => name.trim())
        ? data.priorityNames
        : defaultData.priorityNames;
    els.billPriority.innerHTML = `
        <option value="">Select priority</option>
        ${priorityNames
            .map((priority, index) => `<option value="${index}">${escapeHtml(priority || defaultData.priorityNames[index] || `Priority ${index + 1}`)}</option>`)
            .join("")}
    `;
}

function getAccountOptions(category, type, field) {
    const none = `<option value="">Select account</option>`;
    const missing = `<option value="">Add accounts in Settings</option>`;
    let allowed = [];

    if (isIncomeCategory(category)) {
        if (field === "from") allowed = type === "payment" ? [] : ["bank", "cash"];
        if (field === "to") allowed = type === "payment" ? ["bank", "cash"] : [];
    } else if (isSavingsCategory(category)) {
        const isDeposit = type === "payment" || type === "interest";
        if (field === "from") allowed = isDeposit ? ["bank", "cash"] : ["savings"];
        if (field === "to") allowed = isDeposit ? ["savings"] : ["bank", "cash"];
    } else if (category === "Debt Payments") {
        if (field === "from") allowed = type === "payment" ? ["bank", "cash"] : ["credit"];
        if (field === "to") allowed = type === "payment" ? ["credit"] : ["bank", "cash"];
    } else if (category === "Investments") {
        if (field === "from") allowed = type === "payment" ? ["bank", "cash"] : ["investment"];
        if (field === "to") allowed = type === "payment" ? ["investment"] : ["bank", "cash"];
    } else if (category === "Transfers") {
        allowed = ["bank", "cash", "credit"];
    } else {
        if (field === "from") allowed = type === "payment" ? ["bank", "cash", "credit"] : [];
        if (field === "to") allowed = type === "payment" ? [] : ["bank", "cash", "credit"];
    }

    if (allowed.length === 0) return `<option value="">Select account</option>`;

    const matching = data.accounts
        ? data.accounts.filter(a => allowed.includes(a.type)).sort((a, b) => {
            const ai = ACC_COL_TYPES.findIndex(t => t.type === a.type);
            const bi = ACC_COL_TYPES.findIndex(t => t.type === b.type);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        })
        : [];

    const externalOpt = (category === "Transfers" && field === "from")
        ? `<option value="external">🌐 External (outside the app)</option>`
        : "";

    if (matching.length === 0) return missing + externalOpt;

    const opts = matching.map(a => {
        const emoji = window._ACCOUNT_EMOJIS[a.type] || "🏦";
        return `<option value="${a.id}">${escapeHtml(truncOpt(emoji + ' ' + a.name))}</option>`;
    }).join("");

    return none + externalOpt + opts;
}

function updateTypeOptions(forceType = null) {
    const category = els.billCategory.value;
    if (category === "Transfers") openTransfersInfoModal();
    if (category === "Investments") openInvestmentsInfoModal();
    const currentType = forceType || els.billType.value;
    const priorityWrap = document.getElementById("billPriorityWrap");
    let options = "";

    if (!category) {
        els.billType.innerHTML = `<option value="">Select category first</option>`;
        els.billType.disabled = true;
        els.billPriority.innerHTML = `<option value="">Select category first</option>`;
        els.billPriority.disabled = true;
        els.billPriority.required = false;
        if (priorityWrap) priorityWrap.style.display = "";
        return;
    }

    els.billType.disabled = false;

    if (isIncomeCategory(category)) {
        options = `<option value="">Select type</option>
                   <option value="payment">Received</option>
                   <option value="refund">Returned</option>`;
        els.billType.innerHTML = options;
        if (currentType) els.billType.value = currentType;
        const selectedType = els.billType.value;
        if (selectedType === "payment") {
            if (priorityWrap) priorityWrap.style.display = "none";
            els.billPriority.required = false;
            els.billPriority.value = "";
        } else if (selectedType === "refund") {
            renderPriorityOptions();
            els.billPriority.disabled = false;
            els.billPriority.required = true;
            if (priorityWrap) priorityWrap.style.display = "";
        } else {
            els.billPriority.innerHTML = `<option value="">Select type first</option>`;
            els.billPriority.disabled = true;
            els.billPriority.required = false;
            if (priorityWrap) priorityWrap.style.display = "";
        }
    } else {
        if (isSavingsCategory(category)) {
            options = `<option value="">Select type</option>
                       <option value="payment">Deposit</option>
                       <option value="refund">Withdrawal</option>
                       <option value="interest">Interest</option>`;
        } else if (category === "Investments") {
            options = `<option value="">Select type</option>
                       <option value="payment">Deposit</option>
                       <option value="refund">Withdrawal</option>`;
        } else {
            options = `<option value="">Select type</option>
                       <option value="payment">Payment</option>
                       <option value="refund">Refund</option>`;
        }
        els.billType.innerHTML = options;
        if (currentType) els.billType.value = currentType;
        if (isSavingsCategory(category) && els.billType.value === "interest") {
            if (priorityWrap) priorityWrap.style.display = "none";
            els.billPriority.required = false;
            els.billPriority.value = "";
        } else {
            renderPriorityOptions();
            els.billPriority.disabled = false;
            els.billPriority.required = true;
            if (priorityWrap) priorityWrap.style.display = "";
        }
    }

    const billNameWrap = els.billName.closest("label");
    const billTypeWrap = els.billType.closest("label");

    if (category === "Transfers") {
        if (billNameWrap) billNameWrap.style.display = "none";
        if (billTypeWrap) billTypeWrap.style.display = "none";
        els.billType.value = "payment";
        const fromEl = document.getElementById("billFrom");
        const toEl = document.getElementById("billTo");
        const fromWrap = document.getElementById("billFromWrap");
        const toWrap = document.getElementById("billToWrap");
        if (fromEl) fromEl.innerHTML = getAccountOptions("Transfers", "payment", "from");
        if (toEl) toEl.innerHTML = getAccountOptions("Transfers", "payment", "to");
        if (fromEl) fromEl._allOptions = null;
        if (toEl) toEl._allOptions = null;
        if (fromWrap) fromWrap.style.display = "";
        if (toWrap) toWrap.style.display = "";
        filterAccountDropdowns();
        return;
    } else {
        if (billNameWrap) billNameWrap.style.display = "";
        if (billTypeWrap) billTypeWrap.style.display = "";
    }

    const selectedType = els.billType.value;
    const fromEl = document.getElementById("billFrom");
    const toEl = document.getElementById("billTo");
    const fromWrap = document.getElementById("billFromWrap");
    const toWrap = document.getElementById("billToWrap");
    if (fromEl && toEl) {
        fromEl.innerHTML = getAccountOptions(category, selectedType, "from");
        toEl.innerHTML = getAccountOptions(category, selectedType, "to");
        const fromIsHidden = fromEl.options.length === 0 || (fromEl.options.length === 1 && fromEl.options[0].value === "" && fromEl.options[0].text === "Select account");
        const toIsHidden = toEl.options.length === 0 || (toEl.options.length === 1 && toEl.options[0].value === "" && toEl.options[0].text === "Select account");
        if (fromWrap) fromWrap.style.display = (category && selectedType && !fromIsHidden && selectedType !== "interest") ? "" : "none";
        if (toWrap) toWrap.style.display = (category && selectedType && !toIsHidden) ? "" : "none";
        filterAccountDropdowns();
    }
}

function filterAccountDropdowns() {
    const fromEl = document.getElementById("billFrom");
    const toEl = document.getElementById("billTo");
    if (!fromEl || !toEl) return;

    fromEl._allOptions = Array.from(fromEl.options).map(o => ({ value: o.value, text: o.text }));
    toEl._allOptions = Array.from(toEl.options).map(o => ({ value: o.value, text: o.text }));

    const fromVal = fromEl.value;
    const toVal = toEl.value;

    toEl.innerHTML = toEl._allOptions
        .filter(o => o.value === "" || o.value !== fromVal)
        .map(o => `<option value="${o.value}">${o.text}</option>`).join("");
    toEl.value = toVal !== fromVal ? toVal : "";

    fromEl.innerHTML = fromEl._allOptions
        .filter(o => o.value === "" || o.value !== toVal)
        .map(o => `<option value="${o.value}">${o.text}</option>`).join("");
    fromEl.value = fromVal !== toVal ? fromVal : "";
}

function updateDebtPaymentAccounts() {
    const category = els.billCategory.value;
    const type = els.billType.value;
    const debtName = els.billName.value;
    const fromWrap = document.getElementById("billFromWrap");
    const toWrap = document.getElementById("billToWrap");
    const fromEl = document.getElementById("billFrom");
    const toEl = document.getElementById("billTo");

    if (category !== "Debt Payments") return;
    if (!type || !debtName) {
        if (fromWrap) fromWrap.style.display = "none";
        if (toWrap) toWrap.style.display = "none";
        return;
    }

    const debt = (data.debts || []).find(d => d.name === debtName);

    if (!debt) {
        if (fromWrap) fromWrap.style.display = "none";
        if (toWrap) toWrap.style.display = "none";
        return;
    }

    const linkedAcc = debt.linkedAccountId
        ? (data.accounts || []).find(a => a.id === debt.linkedAccountId)
        : null;

    if (debt.type === "credit_card" && linkedAcc) {
        if (type === "payment") {
            const fromOpts = (data.accounts || [])
                .filter(a => ["bank", "cash"].includes(a.type))
                .map(a => `<option value="${a.id}">${escapeHtml(truncOpt((window._ACCOUNT_EMOJIS[a.type] || "🏦") + ' ' + a.name))}</option>`)
                .join("");
            fromEl.innerHTML = `<option value="">Select account</option>` + fromOpts;
            fromWrap.style.display = "";
            toEl.innerHTML = `<option value="${linkedAcc.id}">${escapeHtml(truncOpt('💳 ' + linkedAcc.name))}</option>`;
            toEl.value = linkedAcc.id;
            toWrap.style.display = "";
        } else {
            fromEl.innerHTML = `<option value="${linkedAcc.id}">${escapeHtml(truncOpt('💳 ' + linkedAcc.name))}</option>`;
            fromEl.value = linkedAcc.id;
            fromWrap.style.display = "";
            const toOpts = (data.accounts || [])
                .filter(a => ["bank", "cash"].includes(a.type))
                .map(a => `<option value="${a.id}">${escapeHtml(truncOpt((window._ACCOUNT_EMOJIS[a.type] || "🏦") + ' ' + a.name))}</option>`)
                .join("");
            toEl.innerHTML = `<option value="">Select account</option>` + toOpts;
            toWrap.style.display = "";
        }
    } else {
        if (type === "payment") {
            fromEl.innerHTML = getAccountOptions("Bills", "payment", "from");
            fromWrap.style.display = "";
            if (toWrap) toWrap.style.display = "none";
        } else {
            if (fromWrap) fromWrap.style.display = "none";
            toEl.innerHTML = getAccountOptions("Bills", "refund", "to");
            toWrap.style.display = "";
        }
    }
}

function updateSavingsAccounts(force = false) {
    const category = els.billCategory.value;
    const type = els.billType.value;
    const fundName = els.billName.value;
    const fromEl = document.getElementById("billFrom");
    const toEl = document.getElementById("billTo");

    if (category !== "Savings" || !type || !fundName) return;

    const goal = (data.savingsGoals || []).find(g => g.name === fundName);
    if (!goal?.accountId) return;

    const linkedAcc = (data.accounts || []).find(a => a.id === goal.accountId);
    if (!linkedAcc) return;

    if (type === "payment" || type === "interest") {
        if (toEl && (force || !toEl.value)) {
            toEl.innerHTML = getAccountOptions(category, "payment", "to");
            if (toEl.querySelector(`option[value="${goal.accountId}"]`)) {
                toEl.value = goal.accountId;
            }
            filterAccountDropdowns();
        }
    } else {
        if (fromEl && (force || !fromEl.value)) {
            fromEl.innerHTML = getAccountOptions(category, type, "from");
            if (fromEl.querySelector(`option[value="${goal.accountId}"]`)) {
                fromEl.value = goal.accountId;
            }
            filterAccountDropdowns();
        }
    }
}

let svAmountPreFilled = false;

function svAddPeriods(date, frequency, interval, periods) {
    const d = new Date(date);
    const steps = periods * interval;
    if (frequency === "daily")   d.setDate(d.getDate() + steps);
    if (frequency === "weekly")  d.setDate(d.getDate() + steps * 7);
    if (frequency === "monthly") {
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + steps);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, lastDay));
    }
    if (frequency === "yearly")  d.setFullYear(d.getFullYear() + steps);
    return d;
}

function updateSavingsEndDateHint() {
    const hintEl = document.getElementById("svEndDateHint");
    if (!hintEl) return;

    const category  = els.billCategory.value;
    const type      = els.billType.value;
    const fundName  = els.billName.value;
    const frequency = els.billFrequency.value;
    const amount    = parseFloat(els.billAmount.value) || 0;
    const interval  = parseInt(els.billInterval.value) || 1;

    if (!isSavingsCategory(category) || type !== "payment" || !fundName ||
        !frequency || frequency === "one-time" || amount <= 0 || els.editingId.value) {
        hintEl.style.display = "none";
        return;
    }

    const goal = (data.savingsGoals || []).find(g => g.name === fundName);
    if (!goal || !goal.goalAmount) { hintEl.style.display = "none"; return; }

    const goalAmt = parseFloat(goal.goalAmount) || 0;
    const saved   = getSvSavedAmount(goal);
    const left = Math.max(0, goalAmt - saved);
    if (left <= 0) { hintEl.style.display = "none"; return; }

    let periodsNeeded = Math.ceil(left / amount - 0.001);
    const startDate = els.billDate.value ? parseLocalDate(els.billDate.value) : new Date();
    let endDate = svAddPeriods(startDate, frequency, interval, periodsNeeded - 1);

    if (goal.goalDate) {
        const goalDate   = parseLocalDate(goal.goalDate);
        const nextPeriod = svAddPeriods(endDate, frequency, interval, 1);
        if (nextPeriod.getTime() === goalDate.getTime()) {
            endDate = goalDate;
            periodsNeeded++;
            const newMonthly = Math.ceil((left / periodsNeeded) * 100) / 100;
            els.billAmount.value = newMonthly.toFixed(2);
            updateCurrencyInputDisplay();
        }
    }

    const yyyy = endDate.getFullYear();
    const mm   = String(endDate.getMonth() + 1).padStart(2, "0");
    const dd   = String(endDate.getDate()).padStart(2, "0");
    els.billEndDate.value = `${yyyy}-${mm}-${dd}`;
    els.billEndDate.classList.add("has-value");

    const endStr   = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const countStr = periodsNeeded === 1 ? "1 payment" : `${periodsNeeded} payments`;
    hintEl.innerHTML = `💡 ${countStr} needed to reach your goal — end date set to ${endStr}. You can change it.<button class="field-hint-close" type="button" onclick="document.getElementById('svEndDateHint').style.display='none';">×</button>`;
    hintEl.style.display = "";
}

function updateSavingsMonthlyHint() {
    const hintEl = document.getElementById("svAmountHint");
    if (!hintEl) return;

    const category = els.billCategory.value;
    const type     = els.billType.value;
    const fundName = els.billName.value;

    const clearHint = () => {
        hintEl.style.display = "none";
        if (svAmountPreFilled) { els.billAmount.value = ""; updateCurrencyInputDisplay(); }
        svAmountPreFilled = false;
    };

    if (!isSavingsCategory(category) || type !== "payment" || !fundName) {
        clearHint(); return;
    }

    const goal = (data.savingsGoals || []).find(g => g.name === fundName);
    if (!goal || !goal.goalDate || !goal.goalAmount) {
        clearHint(); return;
    }

    const goalAmt  = parseFloat(goal.goalAmount) || 0;
    const saved    = getSvSavedAmount(goal);
    const left     = Math.max(0, goalAmt - saved);
    const goalDate = parseLocalDate(goal.goalDate);
    const now      = els.billDate.value ? parseLocalDate(els.billDate.value) : new Date();

    if (left <= 0 || goalDate <= now) {
        clearHint(); return;
    }

    const interval    = parseInt(els.billInterval.value) || 1;
    const frequency   = els.billFrequency.value;
    const daysLeft    = (goalDate - now) / (1000 * 60 * 60 * 24);
    const daysPerPeriod = frequency === "daily"  ? interval
                        : frequency === "weekly" ? 7 * interval
                        : frequency === "yearly" ? 365.25 * interval
                        : 30.44 * interval;
    const periodsNeeded = Math.max(1, Math.ceil(daysLeft / daysPerPeriod));
    const suggested     = Math.ceil((left / periodsNeeded) * 100) / 100;

    els.billAmount.value = suggested.toFixed(2);
    updateCurrencyInputDisplay();
    svAmountPreFilled = true;

    const goalStr = goalDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    hintEl.innerHTML = `💡 Suggested amount to reach your goal by ${goalStr}. You can change it.<button class="field-hint-close" type="button" onclick="this.closest('#svAmountHint').style.display='none';svAmountPreFilled=false;">×</button>`;
    hintEl.style.display = "";
}

function updateSaveAndMarkBtn() {
    if (els.editingId.value) return;
    const category = els.billCategory.value;
    const isRefund = els.billType.value === "refund";
    const saveAndPaidBtn = document.getElementById("saveAndPaidBtn");
    if (!saveAndPaidBtn) return;
    if (isIncomeCategory(category)) {
        saveAndPaidBtn.textContent = isRefund ? "Save & Mark Returned" : "Save & Mark Received";
    } else if (isSavingsCategory(category)) {
        saveAndPaidBtn.textContent = isRefund ? "Save & Mark Withdrawn" : "Save & Mark Saved";
    } else if (category === "Investments") {
        saveAndPaidBtn.textContent = isRefund ? "Save & Mark Withdrawn" : "Save & Mark Invested";
    } else if (category === "Transfers") {
        saveAndPaidBtn.textContent = "Save & Mark Done";
    } else {
        saveAndPaidBtn.textContent = isRefund ? "Save & Mark Refunded" : "Save & Mark Paid";
    }
}

function getMarkPaidLabel(bill) {
    if (bill.type === "refund") {
        if (isSavingsCategory(bill.category)) return "Mark Withdrawn";
        if (bill.category === "Investments") return "Mark Withdrawn";
        return "Mark Returned";
    }
    if (isIncomeCategory(bill.category)) return "Mark Received";
    if (isSavingsCategory(bill.category)) return "Mark Saved";
    if (bill.category === "Investments") return "Mark Invested";
    return "Mark Paid";
}

function getMarkUnpaidLabel(bill) {
    if (bill.type === "refund") {
        if (isSavingsCategory(bill.category)) return "Mark Not Withdrawn";
        if (bill.category === "Investments") return "Mark Not Withdrawn";
        return "Mark Not Returned";
    }
    if (isIncomeCategory(bill.category)) return "Mark Not Received";
    if (isSavingsCategory(bill.category)) return "Mark Not Saved";
    if (bill.category === "Investments") return "Mark Not Invested";
    return "Mark Unpaid";
}

function togglePaid(id) {
    data.bills = data.bills.map(b =>
        b.id === id ? { ...b, paid: !b.paid } : b
    );

    saveData();
    renderAllPreservingCalPanel();
}

function renderFilterOptions() {
    const statusSelect = document.getElementById("filterStatus");
    const prioritySelect = document.getElementById("filterPriority");
    const categorySelect = document.getElementById("filterCategory");
    const monthSelect = document.getElementById("filterMonth");
    const yearSelect = document.getElementById("filterYear");

    const calStatusSelect = document.getElementById("calFilterStatus");
    const calPrioritySelect = document.getElementById("calFilterPriority");
    const calCategorySelect = document.getElementById("calFilterCategory");
    const calMonthSelect = document.getElementById("calFilterMonth");
    const calYearSelect = document.getElementById("calFilterYear");

    if (!statusSelect || !prioritySelect || !categorySelect || !monthSelect || !yearSelect) return;

    const savedStatus   = statusSelect.value;
    const savedPriority = prioritySelect.value;
    const savedCategory = categorySelect.value;
    let savedMonth, savedYear;
    if (!listFiltersLoaded) {
        savedMonth = localStorage.getItem("ultimatePaycheckListMonthFilter") || "";
        savedYear  = localStorage.getItem("ultimatePaycheckListYearFilter")  || "";
        listFiltersLoaded = true;
    } else {
        savedMonth = monthSelect.value;
        savedYear  = yearSelect.value;
    }

    const calSavedStatus = calStatusSelect?.value ?? "";
    const calSavedPriority = calPrioritySelect?.value ?? "";
    const calSavedCategory = calCategorySelect?.value ?? "";
    const calSavedMonth = calMonthSelect?.value ?? "";
    const calSavedYear = calYearSelect?.value ?? "";

    const statusOptions = `
        <option value="">All Statuses</option>
        <option value="unpaid">Planned</option>
        <option value="paid">Done</option>
        <option value="overdue">Overdue</option>
    `;
    statusSelect.innerHTML = statusOptions;
    if (calStatusSelect) calStatusSelect.innerHTML = statusOptions;

    const priorityOptions = `<option value="">All Priorities</option>` +
        data.priorityNames.map((name, i) =>
            `<option value="${i}">${name || `Priority ${i + 1}`}</option>`
        ).join("");
    prioritySelect.innerHTML = priorityOptions;
    if (calPrioritySelect) calPrioritySelect.innerHTML = priorityOptions;

    const categoryOptions = `<option value="">All Categories</option>` +
        data.categories.map(cat =>
            `<option value="${cat}">${cat.toUpperCase()}</option>`
        ).join("") +
        `<option value="Investments">INVESTMENTS</option>` +
        `<option value="Transfers">TRANSFERS</option>`;
    categorySelect.innerHTML = categoryOptions;
    if (calCategorySelect) calCategorySelect.innerHTML = categoryOptions;

    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const monthOptions = `<option value="">All Months</option>` +
        months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
    monthSelect.innerHTML = monthOptions;
    if (calMonthSelect) calMonthSelect.innerHTML = monthOptions;

    const years = [...new Set(
        data.bills
            .filter(b => getBillDisplayDate(b))
            .map(b => parseLocalDate(getBillDisplayDate(b)).getFullYear())
    )].sort();
    const yearOptions = `<option value="">All Years</option>` +
        years.map(y => `<option value="${y}">${y}</option>`).join("");
    yearSelect.innerHTML = yearOptions;
    if (calYearSelect) calYearSelect.innerHTML = yearOptions;

    statusSelect.value = savedStatus;
    prioritySelect.value = savedPriority;
    categorySelect.value = savedCategory;
    monthSelect.value = savedMonth;
    yearSelect.value = savedYear;

    if (calStatusSelect) calStatusSelect.value = calSavedStatus;
    if (calPrioritySelect) calPrioritySelect.value = calSavedPriority;
    if (calCategorySelect) calCategorySelect.value = calSavedCategory;
    if (calMonthSelect) calMonthSelect.value = calSavedMonth;
    if (calYearSelect) calYearSelect.value = calSavedYear;

    if (window.initAllCustomSelects) window.initAllCustomSelects();
}

function renderBills() {
    const statusFilter = document.getElementById("filterStatus")?.value ?? "";
    const priorityFilter = document.getElementById("filterPriority")?.value ?? "";
    const categoryFilter = document.getElementById("filterCategory")?.value ?? "";
    const monthFilter = document.getElementById("filterMonth")?.value ?? "";
    const yearFilter = document.getElementById("filterYear")?.value ?? "";
    localStorage.setItem("ultimatePaycheckListMonthFilter", monthFilter);
    localStorage.setItem("ultimatePaycheckListYearFilter",  yearFilter);
    updateFilterStyles();

    const filtered = applyBillFilters(data.bills, { statusFilter, priorityFilter, categoryFilter, monthFilter, yearFilter });

    if (!filtered.length) {
        els.billList.innerHTML = `<div class="empty">No transactions here yet. Add your first transaction to get started.</div>`;
        return;
    }

    sortBillsChronological(filtered);

    els.billList.innerHTML = filtered.map(bill => {
        const status = getBillStatus(bill);
        return `
        <div class="bill-card ${status} ${bill.paid && statusFilter !== "paid" ? "paid-muted" : `category-color-${bill.category === "Transfers" ? 6 : bill.category === "Investments" ? 7 : Math.max(1, data.categories.indexOf(bill.category) + 1)}`}${bill.type === "interest" ? " bill-type-interest" : ""} ${isIncomeCategory(bill.category) && bill.type === "payment" ? "priority-border-none" : `priority-border-${Number(bill.priority) + 1}`}">
        <div class="bill-info">
  <div class="bill-meta bill-main-line" style="justify-content:space-between;">
    <span class="bill-title-inline app-tooltip-trigger"><span class="bill-title-text">${escapeHtml(bill.name)}</span><span class="app-tooltip">${data.priorityNames[Number(bill.priority)] || "Priority"}</span></span>
    <span class="bill-amount-wrap">
    <span class="bill-amount">
        ${bill.type === "refund" ? `<span class="bill-refund-icon ${(isIncomeCategory(bill.category) || isSavingsCategory(bill.category)) ? "refund-out" : "refund-in"} app-tooltip-trigger">&#x27A1;<span class="app-tooltip">Refund</span></span>` : ""}
        ${bill.type === "interest" ? `<span class="bill-interest-icon app-tooltip-trigger">✦<span class="app-tooltip">Interest</span></span>` : ""}
        <span class="bill-frequency-icon">
            <span class="app-tooltip-trigger">
                ${bill.frequency === "one-time" ? "◷" : "↻"}
                <span class="app-tooltip">
                    ${bill.frequency === "one-time" ? "One-Time" : "Recurring"}
                </span>
            </span>
        </span>

                <span  >${formatMoney(getBillDisplayAmount(bill))}</span>
    </span>

    ${bill.actualAmount != null && Number(bill.amount) > 0 && Number(bill.actualAmount) !== Number(bill.amount)
                ? `<span class="bill-original-amount">${formatMoney(bill.amount)}</span>`
                : ""
            }
    ${(() => {
                const hasOriginal = bill.actualAmount != null && Number(bill.amount) > 0 && Number(bill.actualAmount) !== Number(bill.amount);
                if (bill.category !== "Debt Payments" || bill.debtInterest == null) return "";
                const principal = getBillDebtPrincipal(bill);
                const interest = getBillDebtInterest(bill);
                return `<span class="bill-debt-split bill-debt-split--desktop${hasOriginal ? " bill-debt-split--stacked" : ""}">Principal ${formatMoney(principal)} · Interest ${formatMoney(interest)}</span>`;
            })()}
</span>
  </div>
  ${(bill.fromAccount || bill.toAccount) ? `<div class="bill-accounts-row">${bill.fromAccount ? `<span class="bill-account-tag">⬆️ ${escapeHtml((data.accounts||[]).find(a=>a.id===bill.fromAccount)?.name||'')}</span>` : ''}${bill.fromAccount && bill.toAccount ? ` → ` : ''}${bill.toAccount ? `<span class="bill-account-tag">⬇️ ${escapeHtml((data.accounts||[]).find(a=>a.id===bill.toAccount)?.name||'')}</span>` : ''}</div>` : ''}
  ${(bill.category === "Debt Payments" && bill.debtInterest != null) ? `<div class="bill-debt-split bill-debt-split--mobile">Principal ${formatMoney(getBillDebtPrincipal(bill))} · Interest ${formatMoney(getBillDebtInterest(bill))}</div>` : ''}
  <div class="bill-details-row">
        <div class="bill-date-wrap"><span class="pill app-tooltip-trigger" style="display:inline-flex; align-items:center; gap:6px;"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; opacity:0.4;"><rect x="2" y="5" width="16" height="13" rx="2"/><line x1="2" y1="9" x2="18" y2="9"/><line x1="7" y1="3" x2="7" y2="7"/><line x1="13" y1="3" x2="13" y2="7"/></svg>${formatDisplayDate(parseLocalDate(getBillDisplayDate(bill)))}<span class="app-tooltip">${getBillDateTooltip(bill)}</span></span></div>
    <div class="bill-status-wrap"><span class="bill-countdown">${getDaysLabel(bill)}</span></div>
    ${bill.notes ? `<span class="bill-notes ${bill.notes.length > 30 ? "app-tooltip-trigger" : ""}">${escapeHtml(bill.notes.length > 30 ? bill.notes.slice(0, 30) + "…" : bill.notes)}${bill.notes.length > 30 ? `<span class="app-tooltip-notes">${escapeHtml(bill.notes)}</span>` : ""}</span>` : ""}
  </div>
</div>

<div class="bill-actions">
<button class="mini-btn ${bill.paid ? "unpaid-btn" : "paid-btn"}" onclick="togglePaid('${bill.id}')">${bill.paid ? getUnpaidLabel(bill) : getPaidLabel(bill)}</button>            
<div class="bill-icon-btns">
              <button class="mini-btn edit-btn app-tooltip-trigger" onclick="editBill('${bill.id}')"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5 L16.5 6.5 L7 16 L3 17 L4 13 Z"/><line x1="11" y1="5.5" x2="14.5" y2="9"/></svg><span class="app-tooltip">Edit</span></button>
              <button class="mini-btn delete-btn app-tooltip-trigger" onclick="deleteBill('${bill.id}')"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 17,6"/><path d="M8 6 V4 Q8 3 9 3 H11 Q12 3 12 4 V6"/><path d="M5 6 L6 17 Q6 18 7 18 H13 Q14 18 14 17 L15 6"/><line x1="9" y1="10" x2="9" y2="15"/><line x1="11" y1="10" x2="11" y2="15"/></svg><span class="app-tooltip">Delete</span></button>
              </div>
</div>
          </div>
        `;
    }).join("");
    renderMonthlyNotes();
}

function renderPageHeader(section) {
    const pageHeader = document.getElementById("pageHeader");
    const summaryGrid = document.getElementById("summaryGrid");

    if (!pageHeader || !summaryGrid) return;

    const hidden = ["settings", "backup", "quickstart", "faq"];
    if (hidden.includes(section)) {
        pageHeader.style.display = "none";
        document.querySelector("main")?.classList.add("no-header");
        return;
    }
    document.querySelector("main")?.classList.remove("no-header");

    summaryGrid.style.display = "";

    pageHeader.style.display = "";

    if (section === "list") {
        summaryGrid.innerHTML = `
            <div class="summary-card" data-stat="total">
                <div class="label">Current Balance</div>
                <div class="value" id="totalBills">$0.00</div>
            </div>
            <div class="summary-card" data-stat="paid">
                <div class="label">Projected Balance</div>
                <div class="value" id="paidBills">$0.00</div>
            </div>
            <div class="summary-card" data-stat="overdue">
                <div class="label">Overdue</div>
                <div class="value" id="overdueBills">0</div>
            </div>
            <div class="summary-card" data-stat="today">
                <div class="label">Today is</div>
                <div class="value" id="todayText"></div>
            </div>
        `;
        renderSummaryCards();
        renderListProgressBar();
    } else if (section === "calendar") {
        summaryGrid.innerHTML = `
            <div class="summary-card" data-stat="total">
                <div class="label">Current Balance</div>
                <div class="value" id="calTotalBills">$0.00</div>
            </div>
            <div class="summary-card" data-stat="paid">
                <div class="label">Projected Balance</div>
                <div class="value" id="calPaidBills">$0.00</div>
            </div>
            <div class="summary-card" data-stat="overdue">
                <div class="label">Overdue</div>
                <div class="value" id="calOverdueBills">0</div>
            </div>
            <div class="summary-card" data-stat="today">
                <div class="label">Today is</div>
                <div class="value" id="calTodayText"></div>
            </div>
        `;
        renderCalSummaryCards();
        renderCalProgressBar();
    } else if (section === "paycheck") {
        renderPaycheckHeader();
  
    } else if (section === "monthly") {
        const year = currentCalendarDate.getFullYear();
        const month = currentCalendarDate.getMonth();
        const monthBills = data.bills.filter(bill => {
            const date = parseLocalDate(getBillDisplayDate(bill));
            return date.getFullYear() === year && date.getMonth() === month;
        });
        const catColors = ["var(--mint-text)", "var(--purple-text)", "var(--yellow-text)", "var(--orange-text)", "var(--pink-text)"];
        const cards = data.categories.map((cat, i) => {
            const catBills = monthBills.filter(b => b.category === cat && b.paid);
            const total = sum(catBills);
            return `<div class="summary-card" data-stat="cat-${i + 1}">
                <div class="label">${cat}</div>
                <div class="value" style="color:${catColors[i] || "var(--text)"}">${formatMoney(total)}</div>
            </div>`;
        }).join("");
        summaryGrid.innerHTML = cards;

        const _mk = `${year}-${String(month + 1).padStart(2, "0")}`;
        const rollover = calcAutoRollover(new Date(year, month, 1));
        const spendingCats = data.categories.slice(2);
        const segBarColors = ["var(--yellow)", "var(--orange)", "var(--pink)", "var(--pink)"];

        const incomeRec = monthBills.filter(b => b.category === data.categories[0] && b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
        const savingsRec = monthBills.filter(b => b.category === data.categories[1] && b.type !== "interest" && b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
        const cashSpent = monthBills.filter(b => spendingCats.includes(b.category) && b.paid && !isFromCreditAccount(b)).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
        const investmentsRec = monthBills.filter(b => b.category === "Investments" && b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
        const totalBase = rollover + incomeRec;
        const amountLeft = totalBase - savingsRec - cashSpent - investmentsRec;

        const spendingSegs = spendingCats.map((cat, i) => ({
            color: segBarColors[i] || "var(--peach)",
            amount: monthBills.filter(b => b.category === cat && b.paid && !isFromCreditAccount(b)).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0)
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
        const leftHtml = totalBase > 0
            ? (amountLeft >= -0.005
                ? `<span style="color:var(--mint-text);font-size:12px;white-space:nowrap;"><span class="help-icon" data-help-title="Left to Spend — How it works" data-help="This is the amount of cash available after receiving income, setting aside savings, investing, and paying cash/debit expenses.&lt;br&gt;&lt;br&gt;Any payment made with a &lt;strong&gt;credit card&lt;/strong&gt; is &lt;strong&gt;not deducted&lt;/strong&gt; from this amount — it appears in your category totals but doesn't affect your available cash.&lt;br&gt;&lt;br&gt;Formula: Rollover + Income received − Savings − Investments − Cash expenses" style="cursor:pointer;margin-right:4px;">📊</span>Left to spend <strong>${formatMoney(amountLeft)}</strong></span>`
                : `<span style="color:var(--red);font-size:12px;white-space:nowrap;"><span class="help-icon" data-help-title="Overspent — How it works" data-help="This means your savings, investments, and cash/debit expenses added up to more than your rollover plus income received.&lt;br&gt;&lt;br&gt;Any payment made with a &lt;strong&gt;credit card&lt;/strong&gt; is &lt;strong&gt;not counted&lt;/strong&gt; here — it appears in your category totals but doesn't affect your available cash.&lt;br&gt;&lt;br&gt;Formula: Rollover + Income received − Savings − Investments − Cash expenses" style="cursor:pointer;margin-right:4px;">📊</span>Overspent by <strong>${formatMoney(Math.abs(amountLeft))}</strong></span>`)
            : "";

        ipb.innerHTML = `
            <div class="ipb-track"><div class="ipb-segments">${segHtml || '<div style="width:100%;height:100%;background:var(--bar-bg);"></div>'}</div></div>
            <div class="ipb-labels-row" style="display:flex;justify-content:space-between;width:100%;margin-top:3px;gap:8px;">
                ${leftHtml}<span class="ipb-right-labels">${rightLabels}</span>
            </div>`;
        document.querySelector(".summary-grid-wrap")?.appendChild(ipb);
        document.querySelector(".summary-grid-top")?.classList.add("has-progress-bar");
    } else if (section === "yearly") {
        const year = currentCalendarDate.getFullYear();
        const yearBills = data.bills.filter(bill => {
            const date = parseLocalDate(getBillDisplayDate(bill));
            return date.getFullYear() === year;
        });
        const catColors = ["var(--mint-text)", "var(--purple-text)", "var(--yellow-text)", "var(--orange-text)", "var(--pink-text)"];
        const cards = data.categories.map((cat, i) => {
            const catBills = yearBills.filter(b => b.category === cat && b.paid);
            const total = sum(catBills);
            return `<div class="summary-card" data-stat="cat-${i + 1}">
                <div class="label">${cat}</div>
                <div class="value" style="color:${catColors[i] || "var(--text)"}">${formatMoney(total)}</div>
            </div>`;
        }).join("");
        summaryGrid.innerHTML = cards;

        const existingIpb = document.getElementById("insightsProgressBar");
        if (existingIpb) existingIpb.remove();
        document.querySelector(".summary-grid-top")?.classList.remove("has-progress-bar");
    } else if (section === "accounts") {
        summaryGrid.innerHTML = `
            <div class="summary-card" data-stat="cash">
                <div class="label">Cash</div>
                <div class="value" id="accSumCash">$0.00</div>
            </div>
            <div class="summary-card" data-stat="total">
                <div class="label">Bank</div>
                <div class="value" id="accSumBank">$0.00</div>
            </div>
            <div class="summary-card" data-stat="savings">
                <div class="label">Savings</div>
                <div class="value" id="accSumSavings">$0.00</div>
            </div>
            <div class="summary-card" data-stat="investments">
                <div class="label">Investments</div>
                <div class="value" id="accSumInvestments">$0.00</div>
            </div>
            <div class="summary-card" data-stat="debt">
                <div class="label">Credit Debt</div>
                <div class="value" id="accSumDebt">$0.00</div>
            </div>
        `;
        renderAccountsSummaryCards();
    } else if (section === "savings") {
        summaryGrid.innerHTML = `
            <div class="summary-card" data-stat="sv-goal">
                <div class="label">Total Goal</div>
                <div class="value" id="svSumGoal">$0.00</div>
            </div>
            <div class="summary-card" data-stat="sv-saved">
                <div class="label">Total Saved</div>
                <div class="value" id="svSumSaved">$0.00</div>
            </div>
            <div class="summary-card" data-stat="sv-left">
                <div class="label">Left to Save</div>
                <div class="value" id="svSumLeft">$0.00</div>
            </div>
            <div class="summary-card" data-stat="sv-reached">
                <div class="label">Goals Reached</div>
                <div class="value" id="svSumReached">0 / 0</div>
            </div>
        `;
        renderSavingsSummaryCards();
    } else if (section === "debt") {
        summaryGrid.innerHTML = `
            <div class="summary-card" data-stat="dt-total">
                <div class="label">Total Debt</div>
                <div class="value" id="dtSumTotal">$0.00</div>
            </div>
            <div class="summary-card" data-stat="dt-monthly">
                <div class="label">Paid This Month</div>
                <div class="value" id="dtSumMonthly">$0.00 of $0.00</div>
            </div>
            <div class="summary-card" data-stat="dt-interest">
                <div class="label">Interest This Month</div>
                <div class="value" id="dtSumInterest">$0.00</div>
            </div>
            <div class="summary-card" data-stat="dt-count">
                <div class="label">Paid Off</div>
                <div class="value" id="dtSumCount">0 / 0</div>
            </div>
        `;
        if (typeof renderDebtSummaryCards === "function") renderDebtSummaryCards();
    } else {
        summaryGrid.innerHTML = "";
    }
}

function renderAccountsSummaryCards() {
    const accounts = data.accounts || [];
    let totalCash = 0, totalBank = 0, totalSavings = 0, totalInvestments = 0, totalDebt = 0;

    for (const acc of accounts) {
        const cur = calcAccountBalance(acc.id, "", "").currentBalance;
        if (acc.type === "cash")       totalCash        += cur;
        if (acc.type === "bank")       totalBank        += cur;
        if (acc.type === "savings")    totalSavings     += cur;
        if (acc.type === "investment") totalInvestments += cur;
        if (acc.type === "credit" && cur < 0) totalDebt += Math.abs(cur);
    }

    const el = id => document.getElementById(id);
    if (el("accSumCash"))        el("accSumCash").textContent        = formatMoney(totalCash);
    if (el("accSumBank"))        el("accSumBank").textContent        = formatMoney(totalBank);
    if (el("accSumSavings"))     el("accSumSavings").textContent     = formatMoney(totalSavings);
    if (el("accSumInvestments")) el("accSumInvestments").textContent = formatMoney(totalInvestments);
    if (el("accSumDebt"))        el("accSumDebt").textContent        = formatMoney(totalDebt);
}

function renderCalProgressBar() {
    const existingIpb = document.getElementById("insightsProgressBar");
    if (existingIpb) existingIpb.remove();
    document.querySelector(".summary-grid-top")?.classList.remove("has-progress-bar");

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const bills = data.bills.filter(bill => {
        const date = parseLocalDate(getBillDisplayDate(bill));
        return date.getFullYear() === year && date.getMonth() === month;
    });

    function getAmount(b) { return parseFloat(b.actualAmount ?? b.amount) || 0; }

    const incomeReceived = bills.filter(b => isIncomeCategory(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const incomeReturned = bills.filter(b => isIncomeCategory(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const expensesPaid = bills.filter(b => ["Bills", "Expenses", "Debt Payments"].includes(b.category) && b.type === "payment" && b.paid && !isFromCreditAccount(b)).reduce((s, b) => s + getAmount(b), 0);
    const expensesRefunded = bills.filter(b => ["Bills", "Expenses", "Debt Payments"].includes(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsDone = bills.filter(b => isSavingsCategory(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsWithdrawn = bills.filter(b => isSavingsCategory(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsDone = bills.filter(b => b.category === "Investments" && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsWithdrawn = bills.filter(b => b.category === "Investments" && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);

    const netIncome = incomeReceived - incomeReturned;
    const totalSpent = expensesPaid - expensesRefunded + savingsDone - savingsWithdrawn + investmentsDone - investmentsWithdrawn;
    const pct = incomeReceived > 0 ? Math.round((totalSpent / incomeReceived) * 100) : 0;
    const barWidth = Math.min(pct, 100);
    const isOver = pct > 100;

    const ipb = document.createElement("div");
    ipb.id = "insightsProgressBar";
    ipb.className = "insights-progress-bar visible";
    ipb.innerHTML = `
        <div class="ipb-track"><div class="ipb-fill${isOver ? " ipb-over" : ""}" style="width:${barWidth}%"></div></div>
        <div class="ipb-meta">
            <span class="ipb-meta-left">spent <strong class="ipb-paid-amt" style="color:var(--orange-text);">${formatMoney(totalSpent)}</strong> of <span class="ipb-of" style="color:var(--mint-text);">${formatMoney(netIncome)}</span> received</span>
            <span class="ipb-meta-right">${pct}% spent</span>
        </div>`;
    document.querySelector(".summary-grid-wrap")?.appendChild(ipb);
    document.querySelector(".summary-grid-top")?.classList.add("has-progress-bar");
}

function renderCalSummaryCards() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const bills = data.bills.filter(bill => {
        const date = parseLocalDate(getBillDisplayDate(bill));
        return date.getFullYear() === year && date.getMonth() === month;
    });

    const incomeCategories = ["Income"];
    const expenseCategories = ["Bills", "Expenses", "Debt Payments"];
    const savingsCategories = ["Savings"];

    function getAmount(b) { return parseFloat(b.actualAmount ?? b.amount) || 0; }

    const incomeDone = bills.filter(b => incomeCategories.includes(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const incomeReturned = bills.filter(b => incomeCategories.includes(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const expensesDone = bills.filter(b => expenseCategories.includes(b.category) && b.type === "payment" && b.paid && !isFromCreditAccount(b)).reduce((s, b) => s + getAmount(b), 0);
    const expensesRefunded = bills.filter(b => expenseCategories.includes(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsDone = bills.filter(b => savingsCategories.includes(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsWithdrawn = bills.filter(b => savingsCategories.includes(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsDone = bills.filter(b => b.category === "Investments" && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsWithdrawn = bills.filter(b => b.category === "Investments" && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);

    const currentBalance = incomeDone - incomeReturned - expensesDone + expensesRefunded - savingsDone + savingsWithdrawn - investmentsDone + investmentsWithdrawn;

    const incomePlanned = bills.filter(b => incomeCategories.includes(b.category) && b.type === "payment" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const incomeReturnedPlanned = bills.filter(b => incomeCategories.includes(b.category) && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const expensesPlanned = bills.filter(b => expenseCategories.includes(b.category) && b.type === "payment" && !b.paid && !isFromCreditAccount(b)).reduce((s, b) => s + getAmount(b), 0);
    const expensesRefundedPlanned = bills.filter(b => expenseCategories.includes(b.category) && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsPlanned = bills.filter(b => savingsCategories.includes(b.category) && b.type === "payment" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsWithdrawnPlanned = bills.filter(b => savingsCategories.includes(b.category) && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsPlanned = bills.filter(b => b.category === "Investments" && b.type === "payment" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsWithdrawnPlanned = bills.filter(b => b.category === "Investments" && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);

    const projectedBalance = currentBalance + incomePlanned - incomeReturnedPlanned - expensesPlanned + expensesRefundedPlanned - savingsPlanned + savingsWithdrawnPlanned - investmentsPlanned + investmentsWithdrawnPlanned;

    const overdue = bills.filter(b => getBillStatus(b) === "overdue").length;

    const totalEl = document.getElementById("calTotalBills");
    const paidEl = document.getElementById("calPaidBills");
    const overdueEl = document.getElementById("calOverdueBills");
    const todayEl = document.getElementById("calTodayText");

    if (totalEl) totalEl.textContent = formatMoney(currentBalance);
    if (paidEl) paidEl.textContent = formatMoney(projectedBalance);
    if (overdueEl) {
        overdueEl.textContent = overdue;
        const overdueCard = overdueEl.closest(".summary-card");
        if (overdueCard) overdueCard.classList.toggle("overdue-zero", overdue === 0);
    }
    if (todayEl) todayEl.textContent = formatDisplayDate(new Date());
}

function getListTotals() {
    const categoryFilter = document.getElementById("filterCategory")?.value ?? "";
    const priorityFilter = document.getElementById("filterPriority")?.value ?? "";
    const monthFilter = document.getElementById("filterMonth")?.value ?? "";
    const yearFilter = document.getElementById("filterYear")?.value ?? "";
    const filtered = applyBillFilters(data.bills, { statusFilter: "", priorityFilter, categoryFilter, monthFilter, yearFilter });
    const forCalc = filtered.filter(b => b.type !== "refund" || b.paid);
    return {
        totalExp: sum(forCalc),
        totalPaid: sum(forCalc.filter(b => b.paid))
    };
}

function renderListProgressBar() {
    const existingIpb = document.getElementById("insightsProgressBar");
    if (existingIpb) existingIpb.remove();
    document.querySelector(".summary-grid-top")?.classList.remove("has-progress-bar");

    const monthFilter = document.getElementById("filterMonth")?.value ?? "";
    const yearFilter = document.getElementById("filterYear")?.value ?? "";
    const bills = applyBillFilters(data.bills, { statusFilter: "", priorityFilter: "", categoryFilter: "", monthFilter, yearFilter });

    function getAmount(b) { return parseFloat(b.actualAmount ?? b.amount) || 0; }

    const incomeReceived = bills.filter(b => isIncomeCategory(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const expensesPaid = bills.filter(b => ["Bills", "Expenses", "Debt Payments"].includes(b.category) && b.type === "payment" && b.paid && !isFromCreditAccount(b)).reduce((s, b) => s + getAmount(b), 0);
    const savingsDone = bills.filter(b => isSavingsCategory(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsDone = bills.filter(b => b.category === "Investments" && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsWithdrawn = bills.filter(b => b.category === "Investments" && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);

    const totalSpent = expensesPaid + savingsDone + investmentsDone - investmentsWithdrawn;
    const pct = incomeReceived > 0 ? Math.round((totalSpent / incomeReceived) * 100) : 0;
    const barWidth = Math.min(pct, 100);
    const isOver = pct > 100;

    const html = `
        <div class="ipb-track"><div class="ipb-fill${isOver ? " ipb-over" : ""}" style="width:${barWidth}%"></div></div>
        <div class="ipb-meta">
            <span class="ipb-meta-left">spent <strong class="ipb-paid-amt" style="color:var(--orange-text);">${formatMoney(totalSpent)}</strong> of <span class="ipb-of" style="color:var(--mint-text);">${formatMoney(incomeReceived)}</span> received</span>
            <span class="ipb-meta-right">${pct}% spent</span>
        </div>`;

    let ipb = document.getElementById("insightsProgressBar");
    if (ipb) {
        ipb.innerHTML = html;
        return;
    }
    ipb = document.createElement("div");
    ipb.id = "insightsProgressBar";
    ipb.className = "insights-progress-bar visible";
    ipb.innerHTML = html;
    document.querySelector(".summary-grid-wrap")?.appendChild(ipb);
    document.querySelector(".summary-grid-top")?.classList.add("has-progress-bar");
}

function renderSummaryCards() {
    const monthFilter = document.getElementById("filterMonth")?.value ?? "";
    const yearFilter = document.getElementById("filterYear")?.value ?? "";
    const bills = applyBillFilters(data.bills, { statusFilter: "", priorityFilter: "", categoryFilter: "", monthFilter, yearFilter });

    const incomeCategories = ["Income"];
    const expenseCategories = ["Bills", "Expenses", "Debt Payments"];
    const savingsCategories = ["Savings"];

    function getAmount(b) { return parseFloat(b.actualAmount ?? b.amount) || 0; }

    // Current Balance = income received - expenses paid - savings deposited + savings withdrawn
    const incomeDone = bills.filter(b => incomeCategories.includes(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const incomeReturned = bills.filter(b => incomeCategories.includes(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const expensesDone = bills.filter(b => expenseCategories.includes(b.category) && b.type === "payment" && b.paid && !isFromCreditAccount(b)).reduce((s, b) => s + getAmount(b), 0);
    const expensesRefunded = bills.filter(b => expenseCategories.includes(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsDone = bills.filter(b => savingsCategories.includes(b.category) && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsWithdrawn = bills.filter(b => savingsCategories.includes(b.category) && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsDone = bills.filter(b => b.category === "Investments" && b.type === "payment" && b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsWithdrawn = bills.filter(b => b.category === "Investments" && b.type === "refund" && b.paid).reduce((s, b) => s + getAmount(b), 0);

    const currentBalance = incomeDone - incomeReturned - expensesDone + expensesRefunded - savingsDone + savingsWithdrawn - investmentsDone + investmentsWithdrawn;

    // Projected Balance = current balance + income planned - expenses planned - savings planned + savings withdrawals planned
    const incomePlanned = bills.filter(b => incomeCategories.includes(b.category) && b.type === "payment" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const incomeReturnedPlanned = bills.filter(b => incomeCategories.includes(b.category) && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const expensesPlanned = bills.filter(b => expenseCategories.includes(b.category) && b.type === "payment" && !b.paid && !isFromCreditAccount(b)).reduce((s, b) => s + getAmount(b), 0);
    const expensesRefundedPlanned = bills.filter(b => expenseCategories.includes(b.category) && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsPlanned = bills.filter(b => savingsCategories.includes(b.category) && b.type === "payment" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const savingsWithdrawnPlanned = bills.filter(b => savingsCategories.includes(b.category) && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsPlanned = bills.filter(b => b.category === "Investments" && b.type === "payment" && !b.paid).reduce((s, b) => s + getAmount(b), 0);
    const investmentsWithdrawnPlanned = bills.filter(b => b.category === "Investments" && b.type === "refund" && !b.paid).reduce((s, b) => s + getAmount(b), 0);

    const projectedBalance = currentBalance + incomePlanned - incomeReturnedPlanned - expensesPlanned + expensesRefundedPlanned - savingsPlanned + savingsWithdrawnPlanned - investmentsPlanned + investmentsWithdrawnPlanned;

    const overdue = bills.filter(b => getBillStatus(b) === "overdue").length;

    const totalEl = document.getElementById("totalBills");
    const paidEl = document.getElementById("paidBills");
    const overdueEl = document.getElementById("overdueBills");

    if (totalEl) totalEl.textContent = formatMoney(currentBalance);
    if (paidEl) paidEl.textContent = formatMoney(projectedBalance);
    if (overdueEl) {
        overdueEl.textContent = overdue;
        const overdueCard = overdueEl.closest(".summary-card");
        if (overdueCard) overdueCard.classList.toggle("overdue-zero", overdue === 0);
    }

    const todayEl = document.getElementById("todayText");
    if (todayEl) todayEl.textContent = formatDisplayDate(new Date());
}

function selectCalDay(dateString) {
    const isMobileView = window.innerWidth <= 550;
    if (!isMobileView) return;

    const panel = document.getElementById("calDayPanel");
    if (!panel) return;

    // toggle: click pe aceeași zi închide panelul
    if (selectedCalDay === dateString) {
        selectedCalDay = null;
        panel.style.display = "none";
        toggleCalDrawer(false);
        renderCalendar();
        return;
    }

    selectedCalDay = dateString;

    // dacă era expanded, rămâne expanded cu noua zi
    const wasExpanded = panel.classList.contains("expanded");

    renderCalendar();
    renderCalDayPanel(dateString);

    if (wasExpanded) {
        toggleCalDrawer(true);
    }
}

function renderCalDayPanel(dateString) {
    const panel = document.getElementById("calDayPanel");
    if (!panel) return;

    const d = parseLocalDate(dateString);
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    const dateLabel = `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}`;

    const todayString = toLocalDateInputValue(new Date());
    const isToday = dateString === todayString;

    const statusFilter = document.getElementById("calFilterStatus")?.value ?? "";
    const priorityFilter = document.getElementById("calFilterPriority")?.value ?? "";
    const categoryFilter = document.getElementById("calFilterCategory")?.value ?? "";
    const monthFilter = document.getElementById("calFilterMonth")?.value ?? "";
    const yearFilter = document.getElementById("calFilterYear")?.value ?? "";

    const bills = applyBillFilters(data.bills, { statusFilter, priorityFilter, categoryFilter, monthFilter, yearFilter, dateString });

    sortBills(bills);

    const billCount = bills.length;
    const subLabel = isToday
        ? `Today · ${billCount} transaction${billCount !== 1 ? "s" : ""}`
        : `${billCount} transaction${billCount !== 1 ? "s" : ""}`;

    const billsHtml = bills.length === 0
        ? `<div class="cal-panel-empty">No transactions this day</div>`
        : bills.map(bill => {
            const status = getBillStatus(bill);
            const amount = formatMoney(getBillDisplayAmount(bill));
            const priIndex = bill.priority != null ? Number(bill.priority) + 1 : 5;
            const isIncomeReceived = isIncomeCategory(bill.category) && bill.type === "payment";
            const dotColor = isIncomeReceived ? "transparent" : `var(--priority-${priIndex}-color)`;
            const catIndex = bill.category === "Transfers" ? 6 : bill.category === "Investments" ? 7 : Math.max(1, data.categories.indexOf(bill.category) + 1);

            let btnHtml = "";
            if (status === "paid") {
                btnHtml = `<button class="cal-panel-btn" style="background:var(--orange-soft);color:var(--orange-text);border-color:var(--orange);" onclick="togglePaid('${bill.id}');renderCalDayPanel('${dateString}')">${getMarkUnpaidLabel(bill)}</button>`;
            } else if (status === "overdue") {
                btnHtml = `<button class="cal-panel-btn" style="background:var(--red-soft);color:var(--red-overdue);border-color:var(--red-overdue);" onclick="togglePaid('${bill.id}');renderCalDayPanel('${dateString}')">${getMarkPaidLabel(bill)}</button>`;
            } else {
                btnHtml = `<button class="cal-panel-btn" style="background:var(--green-soft);color:var(--priority-4-color);border-color:var(--green);" onclick="togglePaid('${bill.id}');renderCalDayPanel('${dateString}')">${getMarkPaidLabel(bill)}</button>`;
            }

            const freq = bill.frequency !== "one-time" ? ` · ${bill.frequency}` : "";
            const metaLabel = status === "paid" ? `✅ Paid${freq}` : status === "overdue" ? `⚠️ Overdue${freq}` : `📅 Due${freq}`;

            return `
                <div class="cal-panel-bill ${status} category-color-${catIndex}" onclick="openCalBillModal('${bill.id}')">
                    <div class="cal-panel-dot" style="background:${dotColor};"></div>
                    <div class="cal-panel-info">
                        <div class="cal-panel-name">${escapeHtml(bill.name)}</div>
                        ${(bill.fromAccount || bill.toAccount) ? `<div class="bill-accounts-row">${bill.fromAccount ? `<span class="bill-account-tag">⬆️ ${escapeHtml((data.accounts||[]).find(a=>a.id===bill.fromAccount)?.name||'')}</span>` : ''}${bill.fromAccount && bill.toAccount ? ` → ` : ''}${bill.toAccount ? `<span class="bill-account-tag">⬇️ ${escapeHtml((data.accounts||[]).find(a=>a.id===bill.toAccount)?.name||'')}</span>` : ''}</div>` : ''}
                        ${bill.notes ? `<div class="cal-panel-notes">${escapeHtml(bill.notes)}</div>` : ""}
                    </div>
                    <div class="cal-panel-amount">${bill.type === "refund" ? `<span class="bill-refund-icon ${(isIncomeCategory(bill.category) || isSavingsCategory(bill.category)) ? "refund-out" : "refund-in"}">&#x27A1;</span>` : ""}<span class="cal-amount-main"><span class="bill-frequency-icon">${bill.frequency === "one-time" ? "◷" : "↻"}</span><span>${amount}</span></span>${bill.actualAmount != null && Number(bill.amount) > 0 && Number(bill.actualAmount) !== Number(bill.amount) ? `<span class="bill-original-amount">${formatMoney(bill.amount)}</span>` : ""}</div>
                </div>`;
        }).join("");

    panel.innerHTML = `
        <div class="cal-panel-header" onclick="toggleCalDrawer()">
            <span class="cal-panel-handle"></span>
        </div>
        <div style="padding: 0 14px 0;">
            <div class="cal-panel-date">📅 ${dateLabel}</div>
            <div class="cal-panel-sub">${subLabel}</div>
        </div>
        <div class="cal-panel-bills">${billsHtml}</div>
    `;

    panel.style.display = "block";
    panel.style.minHeight = "";
    panel.classList.remove("expanded");
    panel.style.transition = "none";
    panel.style.opacity = "0";

    requestAnimationFrame(() => {
        const rect = panel.getBoundingClientRect();
        const remaining = window.innerHeight - rect.top;
        const billsEl = panel.querySelector(".cal-panel-bills");

        panel.style.minHeight = remaining + "px";

        if (billsEl) {
            const billsRect = billsEl.getBoundingClientRect();
            const billsRemaining = window.innerHeight - billsRect.top;

            billsEl.style.maxHeight = billsRemaining + "px";
            billsEl.style.overflowY = "auto";
        }

        panel.style.transition = "opacity 0.25s ease";
        panel.style.opacity = "1";
    });
}

function toggleCalDrawer(forceState) {
    const panel = document.getElementById("calDayPanel");
    const overlay = document.getElementById("calDrawerOverlay");
    if (!panel) return;

    const billsEl = panel.querySelector(".cal-panel-bills");
    const hasBills = panel.querySelectorAll(".cal-panel-bill").length > 0;
    const isExpanded = panel.classList.contains("expanded");

    if (forceState === false || isExpanded) {
        panel.classList.remove("expanded");
        panel.style.maxHeight = "";
        if (billsEl) {
            billsEl.style.maxHeight = "";
            billsEl.style.overflowY = "";
        }
        if (overlay) overlay.classList.remove("active");
        return;
    }

    const needsExpand = hasBills;

    if (!needsExpand && forceState !== true) return;
    panel.classList.add("expanded");
    if (overlay) overlay.classList.add("active");

    requestAnimationFrame(() => {
        const panelTopLimit = 20;
        const maxPanelHeight = window.innerHeight - panelTopLimit;

        panel.style.maxHeight = maxPanelHeight + "px";

        if (billsEl) {
            billsEl.style.maxHeight = "none";

            const billsTop = billsEl.getBoundingClientRect().top;
            const availableBillsHeight = window.innerHeight - billsTop;

            if (billsEl.scrollHeight > availableBillsHeight) {
                billsEl.style.maxHeight = availableBillsHeight + "px";
                billsEl.style.overflowY = "auto";
            } else {
                billsEl.style.maxHeight = "none";
                billsEl.style.overflowY = "visible";
            }
        }
    });
}

function getWeekStartIndex() {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const idx = days.indexOf(data.settings.weekStart);
    return idx === -1 ? 0 : idx;
}

function renderCalendar() {
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    const calNavPeriod = document.getElementById("calNavPeriod");

    if (calNavPeriod) {
        const periods = [...new Set(
            data.bills
                .filter(b => getBillDisplayDate(b))
                .map(b => {
                    const d = parseLocalDate(getBillDisplayDate(b));
                    return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
                })
        )];

        const currentKey = `${year}-${String(month).padStart(2, "0")}`;
        if (!periods.includes(currentKey)) periods.push(currentKey);

        periods.sort();

        calNavPeriod.innerHTML = periods.map(p => {
            const [y, m] = p.split("-").map(Number);
            const label = `${monthNames[m]} ${y}`;
            return `<option value="${p}" ${p === currentKey ? "selected" : ""}>${label}</option>`;
        }).join("");

        delete calNavPeriod.dataset.csdInit;
        calNavPeriod.style.display = "";
        const existingWrapper = calNavPeriod.closest(".csd-wrapper");
        if (existingWrapper) existingWrapper.replaceWith(calNavPeriod);
        if (window.initAllCustomSelects) window.initAllCustomSelects();

        const calTitle = document.getElementById("calendarTitle");
        if (calTitle) {
            calTitle.className = `calendar-title cal-month-${month + 1}`;
        }

        setTimeout(() => {
            const trigger = document.querySelector("#calendarTitle .csd-trigger");
            if (trigger) {
                const monthNum = month + 1;
                const colorMap = {
                    1: { text: "var(--pink)", textHover: "var(--pink-text)", bg: "var(--pink-soft-2)", arrow: "%23fe7aa7", arrowHover: "%23fa3a7c" },
                    2: { text: "var(--orange)", textHover: "var(--orange-text)", bg: "var(--orange-soft-2)", arrow: "%23fea969", arrowHover: "%23f36300" },
                    3: { text: "var(--yellow)", textHover: "var(--yellow-text)", bg: "var(--yellow-soft-2)", arrow: "%23ffcf5f", arrowHover: "%23c48600" },
                    4: { text: "var(--mint)", textHover: "var(--mint-text)", bg: "var(--mint-soft-2)", arrow: "%2377dddb", arrowHover: "%23037c7c" },
                    5: { text: "var(--purple)", textHover: "var(--purple-text)", bg: "var(--purple-soft-2)", arrow: "%23d299dc", arrowHover: "%238c4698" },
                    6: { text: "var(--peach)", textHover: "var(--peach-text)", bg: "var(--peach-soft-2)", arrow: "%23ffc5cb", arrowHover: "%23d07b82" },
                    7: { text: "var(--pink)", textHover: "var(--pink-text)", bg: "var(--pink-soft-2)", arrow: "%23fe7aa7", arrowHover: "%23fa3a7c" },
                    8: { text: "var(--orange)", textHover: "var(--orange-text)", bg: "var(--orange-soft-2)", arrow: "%23fea969", arrowHover: "%23f36300" },
                    9: { text: "var(--yellow)", textHover: "var(--yellow-text)", bg: "var(--yellow-soft-2)", arrow: "%23ffcf5f", arrowHover: "%23c48600" },
                    10: { text: "var(--mint)", textHover: "var(--mint-text)", bg: "var(--mint-soft-2)", arrow: "%2377dddb", arrowHover: "%23037c7c" },
                    11: { text: "var(--purple)", textHover: "var(--purple-text)", bg: "var(--purple-soft-2)", arrow: "%23d299dc", arrowHover: "%238c4698" },
                    12: { text: "var(--peach)", textHover: "var(--peach-text)", bg: "var(--peach-soft-2)", arrow: "%23ffc5cb", arrowHover: "%23d07b82" },
                };
                const c = colorMap[monthNum];
                if (c) {
                    trigger.style.color = c.text;
                    trigger.style.setProperty("background-image", `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='${c.arrow}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E")`, "important");
                    trigger.style.setProperty("--cal-hover-bg", c.bg);
                    trigger.style.setProperty("--cal-hover-text", c.textHover);
                    trigger.style.setProperty("--cal-arrow-hover", c.arrowHover);
                    trigger.dataset.arrow = c.arrow;
                    trigger.dataset.arrowHover = c.arrowHover;
                }
            }
        }, 0);
    }

    const weekStartIdx = getWeekStartIndex();
    const isMobileView = window.innerWidth <= 550;
    const rotateWeek = arr => arr.slice(weekStartIdx).concat(arr.slice(0, weekStartIdx));
    const dayNames = isMobileView
        ? rotateWeek(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
        : rotateWeek(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startOffset = (firstDay.getDay() - weekStartIdx + 7) % 7;

    const statusFilter = document.getElementById("calFilterStatus")?.value ?? "";
    const priorityFilter = document.getElementById("calFilterPriority")?.value ?? "";
    const categoryFilter = document.getElementById("calFilterCategory")?.value ?? "";
    const monthFilter = document.getElementById("calFilterMonth")?.value ?? "";
    const yearFilter = document.getElementById("calFilterYear")?.value ?? "";

    const cells = [];
    const weekendColIndexes = [(0 - weekStartIdx + 7) % 7, (6 - weekStartIdx + 7) % 7];
    dayNames.forEach((name, i) => {
        const isWknd = weekendColIndexes.includes(i);
        cells.push(`<div class="day-name${isWknd ? ' weekend' : ''}">${name}</div>`);
    });

    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = 0; i < startOffset; i++) {
        const prevDay = prevMonthLastDay - startOffset + i + 1;
        const prevDateString = toLocalDateInputValue(new Date(year, month - 1, prevDay));
        const prevBills = isMobileView ? [] : applyBillFilters(data.bills, { statusFilter, priorityFilter, categoryFilter, monthFilter, yearFilter, dateString: prevDateString });
        sortBills(prevBills);
        cells.push(`<div class="day muted" data-date="${prevDateString}"><div class="day-number">${prevDay}</div>${prevBills.map(bill => {
            const status = getBillStatus(bill);
            const catIndex = bill.category === "Transfers" ? 6 : bill.category === "Investments" ? 7 : Math.max(1, data.categories.indexOf(bill.category) + 1);
            const priIndex = Number(bill.priority) + 1;
            return `<button class="cal-bill ${status} category-color-${catIndex}" data-bill-id="${bill.id}" onclick="openCalBillModal('${bill.id}')" title="${escapeHtml(bill.name)}"><span class="cal-bill-bar pri-bar-${priIndex}"></span><span class="cal-bill-name">${escapeHtml(bill.name)}</span><span class="cal-bill-amount"  >${formatMoney(getBillDisplayAmount(bill))}</span></button>`;
        }).join("")}</div>`);
    }

    const today = new Date();
    const todayString = toLocalDateInputValue(today);

    for (let day = 1; day <= lastDay.getDate(); day++) {
        const dateString = toLocalDateInputValue(new Date(year, month, day));
        const dayOfWeek = new Date(year, month, day).getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isToday = dateString === todayString;

        const bills = applyBillFilters(data.bills, { statusFilter, priorityFilter, categoryFilter, monthFilter, yearFilter, dateString });

        sortBills(bills);

        if (isMobileView) {
            const hasOverdue = bills.some(b => getBillStatus(b) === "overdue");
            const overdueClass = hasOverdue ? " overdue-pip" : "";
            const selectedClass = dateString === selectedCalDay ? " selected-day" : "";
            const today = new Date(); today.setHours(0,0,0,0);
            const highlightOn = (data.paycheckSettings?.highlightCalendar || "yes") === "yes";
            const activePaycheck = highlightOn ? (data.paychecks || []).find(pc => {
                const s = parseLocalDate(pc.startDate); const e = parseLocalDate(pc.endDate);
                return today >= s && today <= e;
            }) : null;
            const paycheckClass = activePaycheck && dateString >= activePaycheck.startDate && dateString <= activePaycheck.endDate ? " paycheck-active" : "";
            const pips = bills.map(b => {
                const pi = b.priority != null ? Number(b.priority) + 1 : 5;
                const isIncomeReceived = isIncomeCategory(b.category) && b.type === "payment";
                const color = isIncomeReceived ? "var(--mint)" : `var(--priority-${pi}-color)`;
                return `<div class="cal-pip" style="background:${b.paid ? "var(--done-text)" : color}; opacity:${b.paid ? "0.45" : "1"};"></div>`;
            }).join("");
            cells.push(`
              <div class="day${isToday ? " today" : ""}${isWeekend ? " weekend" : ""}${overdueClass}${selectedClass}${paycheckClass}" data-date="${dateString}">
                <div class="day-number">${day}</div>
                <div class="cal-pips-row">${pips}</div>
              </div>
            `);
        } else {
            const highlightOn = (data.paycheckSettings?.highlightCalendar || "yes") === "yes";
            const activePaycheck = highlightOn ? (data.paychecks || []).find(pc => {
                const s = parseLocalDate(pc.startDate); const e = parseLocalDate(pc.endDate);
                const td = new Date(); td.setHours(0,0,0,0);
                return td >= s && td <= e;
            }) : null;
            const paycheckClass = activePaycheck && dateString >= activePaycheck.startDate && dateString <= activePaycheck.endDate ? " paycheck-active" : "";
            cells.push(`
              <div class="day${isToday ? " today" : ""}${isWeekend ? " weekend" : ""}${paycheckClass}" data-date="${dateString}" ondblclick="openAddBillWithDate('${dateString}')">
                <div class="day-number">${day}</div>
                ${bills.map(bill => {
                const status = getBillStatus(bill);
                const catIndex = bill.category === "Transfers" ? 6 : bill.category === "Investments" ? 7 : Math.max(1, data.categories.indexOf(bill.category) + 1);
                const priIndex = Number(bill.priority) + 1;
                const barClass = (isIncomeCategory(bill.category) && bill.type === "payment") ? "pri-bar-none" : `pri-bar-${priIndex}`;
                return `<button class="cal-bill ${status} category-color-${catIndex}" data-bill-id="${bill.id}" onclick="openCalBillModal('${bill.id}')" title="${escapeHtml(bill.name)}"><span class="cal-bill-bar ${barClass}"></span><span class="cal-bill-name">${escapeHtml(bill.name)}</span>
                <span class="cal-bill-amount"  >${formatMoney(getBillDisplayAmount(bill))}</span>
                </button>`;
            }).join("")}
              </div>
            `);
        }
    }

    const totalCells = startOffset + lastDay.getDate();
    const trailingCount = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= trailingCount; i++) {
        const nextDateString = toLocalDateInputValue(new Date(year, month + 1, i));
        const nextBills = isMobileView ? [] : applyBillFilters(data.bills, { statusFilter, priorityFilter, categoryFilter, monthFilter, yearFilter, dateString: nextDateString });
        sortBills(nextBills);
        cells.push(`<div class="day muted" data-date="${nextDateString}"><div class="day-number">${i}</div>${nextBills.map(bill => {
            const status = getBillStatus(bill);
            const catIndex = bill.category === "Transfers" ? 6 : bill.category === "Investments" ? 7 : Math.max(1, data.categories.indexOf(bill.category) + 1);
            const priIndex = Number(bill.priority) + 1;
            return `<button class="cal-bill ${status} category-color-${catIndex}" data-bill-id="${bill.id}" onclick="openCalBillModal('${bill.id}')" title="${escapeHtml(bill.name)}"><span class="cal-bill-bar pri-bar-${priIndex}"></span><span class="cal-bill-name">${escapeHtml(bill.name)}</span><span class="cal-bill-amount"  >${formatMoney(getBillDisplayAmount(bill))}</span></button>`;
        }).join("")}</div>`);
    }

    els.calendarGrid.innerHTML = cells.join("");

    if (isMobileView) {
        els.calendarGrid.addEventListener("contextmenu", e => e.preventDefault());
        let longPressTimer = null;
        let longPressFired = false;
        els.calendarGrid.querySelectorAll(".day[data-date]").forEach(cell => {
            const dateString = cell.dataset.date;
            cell.addEventListener("touchstart", e => {
                longPressFired = false;
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    longPressFired = true;
                    e.preventDefault();
                    openAddBillWithDate(dateString);
                }, 500);
            }, { passive: false });
            cell.addEventListener("touchend", e => {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                if (longPressFired) { longPressFired = false; return; }
                selectCalDay(dateString);
            });
            cell.addEventListener("touchmove", () => {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            });
        });
    } else {
        initCalendarDragDrop();
    }

    renderCalSummaryCards();
    if (currentActiveSection === "calendar") {
        renderCalProgressBar();
    }

    if (isMobileView) {
        if (selectedCalDay === null) {
            const todayStr = toLocalDateInputValue(new Date());
            selectedCalDay = todayStr;
        }

        renderCalDayPanel(selectedCalDay);

        const selectedCell = els.calendarGrid.querySelector(`.day[data-date="${selectedCalDay}"]`);
        if (selectedCell) selectedCell.classList.add("selected-day");
    } else {
        const panel = document.getElementById("calDayPanel");
        if (panel) panel.style.display = "none";
    }
}


function renderMiniCalendar(containerId = "miniCalendar") {
    const container = document.getElementById(containerId);
    if (!container) return;
    const prefix = containerId;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    const today = new Date();

    const weekStartIdx = getWeekStartIndex();

    const fullLetters = ["S", "M", "T", "W", "T", "F", "S"];
    const dayNames = fullLetters.slice(weekStartIdx).concat(fullLetters.slice(0, weekStartIdx));

    const weekendIndexes = [(0 - weekStartIdx + 7) % 7, (6 - weekStartIdx + 7) % 7];

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let html = `
  <div class="mini-calendar-title">
    <button class="mini-cal-nav" id="${prefix}Prev">‹</button>
    <span>${new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
    <button class="mini-cal-nav" id="${prefix}Next">›</button>
  </div>
  <div class="mini-calendar-grid">
   ${dayNames.map((d, i) =>
        `<div class="mini-calendar-day ${weekendIndexes.includes(i) ? "weekend" : ""}">${d}</div>`
    ).join("")}
`;

    let offset = (firstDay.getDay() - weekStartIdx + 7) % 7;

    for (let i = 0; i < offset; i++) {
        html += `<div></div>`;
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
        const isToday = d === today.getDate();
        const dayOfWeek = new Date(year, month, d).getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        html += `<div class="mini-calendar-date ${isToday ? "today" : ""} ${isWeekend ? "weekend" : ""}">${d}</div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    document.getElementById(`${prefix}Prev`).onclick = () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
        renderMiniCalendar("miniCalendar");
        renderMiniCalendar("miniCalendarDesktop");
    };

    document.getElementById(`${prefix}Next`).onclick = () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
        renderMiniCalendar("miniCalendar");
        renderMiniCalendar("miniCalendarDesktop");
    };

}


function renderMonthlyInsights() {
    const el = document.getElementById("categoryBreakdown");
    if (!el) return;

    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();

    const monthBills = data.bills.filter(bill => {
        const d = parseLocalDate(bill.dueDate);
        return d.getMonth() === month && d.getFullYear() === year;
    });

    const catColors = [
        { main: "#77dddb", shades: ["#4ecece", "#77dddb", "#9de8e7", "#b8efee", "#cdf4f3", "#dff8f8"], soft: "var(--mint-soft-2)", soft3: "var(--mint-soft-3)", tableBg: "rgba(116, 255, 253, 0.06)", text: "var(--mint-text)", border: "#9ce4e3", inputColor: "var(--mint-dark, #025e5e)" },
        { main: "#d299dc", shades: ["#c285d0", "#d299dc", "#ddb0e8", "#eaccf2", "#f5e5f9", "#faf0fc"], soft: "var(--purple-soft-2)", soft3: "var(--purple-soft-3)", tableBg: "rgba(210,153,220,0.06)", text: "var(--purple-text)", border: "#ddb0e8", inputColor: "var(--purple-text)" },
        { main: "#ffcf5f", shades: ["#f0b830", "#ffcf5f", "#ffe08a", "#ffedb3", "#fff7d9", "#fffdf0"], soft: "var(--yellow-soft-2)", soft3: "var(--yellow-soft-3)", tableBg: "rgba(255,207,95,0.06)", text: "var(--yellow-text)", border: "#ffe08a", inputColor: "var(--yellow-text)" },
        { main: "#fea969", shades: ["#f08848", "#fea969", "#ffc090", "#ffd4b5", "#ffeada", "#fff5ee"], soft: "var(--orange-soft-2)", soft3: "var(--orange-soft-3)", tableBg: "rgba(254,169,105,0.06)", text: "var(--orange-text)", border: "#ffd0a0", inputColor: "var(--orange-text)" },
        { main: "#fe7aa7", shades: ["#f06090", "#fe7aa7", "#ffaac8", "#ffcbde", "#ffe5ef", "#fff5f8"], soft: "var(--pink-soft-2)", soft3: "var(--pink-soft-3)", tableBg: "rgba(254,122,167,0.06)", text: "var(--pink-text)", border: "#ffb0cc", inputColor: "var(--pink-text)" }
    ];


    const _mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    const _mb = data.monthlyBudgets?.[_mk] || {};
    const totalBudget = parseFloat(_mb.total || 0);
    const catSum = Object.values(_mb.categories || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const overdraftAmount = totalBudget > 0 && catSum > totalBudget ? catSum - totalBudget : 0;

    el.className = "mi-cat-grid";
    el.innerHTML = renderSummaryCard(catColors, monthBills, month, year, _mk) + data.categories.map((cat, idx) => {
        const color = catColors[idx % catColors.length];
        return renderCategoryCard(cat, color, monthBills, month, year, overdraftAmount, _mk, idx);
    }).join("");
}

function renderSummaryCard(catColors, monthBills, month, year, _mk, cutoffDate) {
    const R = 66, CX = 90, CY = 90, SW = 30, CIRC = 2 * Math.PI * R;
    const GAP = 1.5;
    const monthName = new Date(year, month).toLocaleString("default", { month: "short" });

    // Per-category totals
    const catData = data.categories.map((cat, idx) => {
        const color = catColors[idx % catColors.length];
        const catBills = monthBills.filter(b => b.category === cat);
        const payments = catBills.filter(b => b.type !== "refund");
        const totalExp = catBills.reduce((s, b) => b.type === "refund" ? s - (parseFloat(b.amount) || 0) : s + (parseFloat(b.amount) || 0), 0);
        const totalPaid = catBills.filter(b => b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
        const budgetSource = isPaycheckKey(_mk) ? data.paycheckBudgets : data.monthlyBudgets;
        const budget = parseFloat(budgetSource?.[_mk]?.categories?.[cat] || 0);
        return { cat, color, totalExp, totalPaid, budget, payments };
    });

    const grandExp = catData.reduce((s, c) => s + c.totalExp, 0);
    const grandPaid = catData.reduce((s, c) => s + c.totalPaid, 0);
    const grandBudget = catData.reduce((s, c) => s + c.budget, 0);
    const grandLeftToPay = catData.reduce((s, c) => s + sum(c.payments.filter(b => !b.paid)), 0);

    const max = Math.max(grandBudget, grandExp, 1);
    const expPct = Math.min((grandExp / max) * 100, 100);
    const paidPct = Math.min((grandPaid / max) * 100, 100);

    // Pills
    let pill1Class = "mi-pill-neutral", pill1Val = "Set a budget to track planning";
    if (grandBudget > 0) {
        const room = grandBudget - grandExp;
        if (room > 0) { pill1Class = "mi-pill-green"; pill1Val = `You can still plan ${formatMoney(room)} more`; }
        else if (room === 0) { pill1Class = "mi-pill-green"; pill1Val = "Budget fully allocated"; }
        else { pill1Class = "mi-pill-red"; pill1Val = `${formatMoney(Math.abs(room))} over budget`; }
    }
    const pill2Class = grandLeftToPay <= 0 ? "mi-pill-green" : "mi-pill-yellow";
    const pill2Val = grandLeftToPay <= 0 ? "All paid ✓" : `${formatMoney(grandLeftToPay)} left to pay`;

    // Pie
    const donutData = catData.filter((_, idx) => idx !== 0);
    let donutSegments = "", legendItems = "", offset = 0;
    const totalNet = donutData.reduce((s, c) => s + c.totalExp, 0);
    if (totalNet <= 0) {
        donutSegments = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e0e0e0" stroke-width="${SW}"/>`;
    } else {
        donutData.forEach(({ cat, color, totalExp: net }) => {
            if (net <= 0) return;
            const pct = net / totalNet;
            const dash = pct * CIRC;
            const billPct = Math.round(pct * 100);
            donutSegments += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color.main}" stroke-width="${SW}" stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${CX} ${CY})" stroke-linecap="butt"/>`;
            if (billPct >= 6) {
                const midAngle = ((offset + dash / 2) / CIRC) * 2 * Math.PI - Math.PI / 2;
                const lx = (CX + R * Math.cos(midAngle)).toFixed(1);
                const ly = (CY + R * Math.sin(midAngle)).toFixed(1);
                donutSegments += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="600" fill="#666">${billPct}%</text>`;
            }
            legendItems += `<div class="mi-dl-item"><div class="mi-dl-dot" style="background:${color.main};"></div><span class="mi-dl-name" style="color:${color.text};text-transform:uppercase;">${cat}</span></div>`;
            offset += dash;
        });
        // gaps
        let gapOffset = 0;
        donutData.forEach(({ totalExp: net }) => {
            if (net <= 0) return;
            const dash = (net / totalNet) * CIRC;
            gapOffset += dash;
            const angle = (gapOffset / CIRC) * 2 * Math.PI - Math.PI / 2;
            const x1 = (CX + (R - SW / 2) * Math.cos(angle)).toFixed(1);
            const y1 = (CY + (R - SW / 2) * Math.sin(angle)).toFixed(1);
            const x2 = (CX + (R + SW / 2) * Math.cos(angle)).toFixed(1);
            const y2 = (CY + (R + SW / 2) * Math.sin(angle)).toFixed(1);
            donutSegments += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${GAP}" stroke-linecap="round"/>`;
        });
    }

    // Table rows
    const tableRows = catData.map(({ cat, color, totalExp, totalPaid }) => `
        <tr>
            <td><div class="mi-td-name" style="color:${color.text};text-transform:uppercase;">${cat}</div></td>
            <td class="mi-td-exp">${formatMoney(totalExp)}</td>
            <td style="color:${color.text};">${formatMoney(totalPaid)}</td>
        </tr>`).join("");

    const _periodStart = cutoffDate || new Date(year, month, 1);
    const autoRollover = calcAutoRollover(_periodStart);
    const _rolloverCats = new Set([...(data.categories || []), "Investments"]);
    const _hasPriorBills = (data.bills || []).some(b => b.paid && _rolloverCats.has(b.category) && parseLocalDate(getBillDisplayDate(b)) < _periodStart);
    const _rolloverLabel = _hasPriorBills
        ? `Rollover from ${new Date(year, month - 1).toLocaleString("default", { month: "long" })}`
        : "Starting Balance";
    const _helpTitle = _hasPriorBills ? "Rollover — How it works" : "Starting Balance — How it works";
    const _helpText  = _hasPriorBills
        ? "Amount carried over from the previous period, calculated automatically from your paid transactions."
        : "The sum of your bank and cash account start balances — the money you had available before any transactions were recorded.";

    return `
        <div class="mi-cat-card">
            <div class="mi-cat-header" style="background:var(--peach);">
                <div class="mi-cat-header-name">${new Date(year, month).toLocaleString("default", { month: "long" }).toUpperCase()} BREAKDOWN</div>
            </div>
            <div class="mi-budget-section" style="background:var(--peach-soft-2);padding-bottom: 0px;">
                <div class="mi-budget-top-row">
                    <span class="mi-budget-label" style="color:var(--peach-text);"><span class="help-icon" data-help-title="${_helpTitle}" data-help="${_helpText}" style="cursor:pointer;margin-right:6px;">🪙</span>${_rolloverLabel}</span>
                    <span class="mi-rollover-value" style="color:${autoRollover !== 0 ? 'var(--peach-text)' : 'var(--muted)'};">${formatMoney(autoRollover)}</span>
                </div>
                </div>
            <div style="background:var(--white);padding:10px 10px 4px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);">
                ${(() => {
            const maxVal = Math.max(...catData.map(c => Math.max(c.totalExp, c.totalPaid)), 1);
            return catData.map(({ cat, color, totalExp, totalPaid }) => {
                const expW = Math.min((totalExp / maxVal) * 100, 100).toFixed(1);
                const paidW = Math.min((totalPaid / maxVal) * 100, 100).toFixed(1);
                return `<div class="mi-bar-duo-group">
                            <div class="mi-bar-duo-label" style="color:${color.text};">${cat}</div>
                            <div class="mi-bar-duo-bars">
                                <div class="mi-bar-duo-row"><div class="mi-bar-duo" style="width:${expW}%;background:var(--bar-expected);"></div></div>
                                <div class="mi-bar-duo-row"><div class="mi-bar-duo" style="width:${paidW}%;background:${color.main};"></div></div>
                            </div>
                        </div>`;
            }).join('');
        })()}
                <div class="mi-bar-duo-legend">
                    <span><span class="mi-bar-duo-dot" style="background:var(--bar-expected);"></span>Expected</span>
                    <span><span class="mi-bar-duo-dot" style="background:var(--peach);"></span>Paid</span>
                </div>
            </div>
            <div class="mi-table-scroll mi-table-summary" style="background:var(--peach-soft-3);">
                <table class="mi-cat-table">
                    <thead style="background:var(--peach-soft-2);"><tr><th>Category</th><th>Expected</th><th>Paid</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <div class="mi-donut-section" style="border-top:2px solid var(--line);">
                <svg viewBox="0 0 180 180" role="img" class="mi-donut-svg" aria-label="MONTHLY BREAKDOWN">
                    ${donutSegments}
                    <text x="${CX}" y="${CY - 6}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--peach-text)">${monthName}</text>
                    <text x="${CX}" y="${CY + 10}" text-anchor="middle" font-size="11" fill="#999">BREAKDOWN</text>
                </svg>
                <div class="mi-donut-legend">${legendItems || '<span style="font-size:11px;color:var(--muted);">No transactions this month</span>'}</div>
            </div>
        </div>`;
}

function renderCategoryCard(cat, color, monthBills, month, year, overdraftAmount, _mk, idx) {
    const catBills = monthBills.filter(b => b.category === cat);
    const payments = catBills.filter(b => b.type !== "refund");
    const refunds = catBills.filter(b => b.type === "refund");
    const totalExp = catBills.reduce((s, b) => b.type === "refund" ? s - (parseFloat(b.amount) || 0) : s + (parseFloat(b.amount) || 0), 0);
    const totalPaid = catBills.filter(b => b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
    const totalLeftToPay = sum(payments.filter(b => !b.paid));
    const budgetSource = isPaycheckKey(_mk) ? data.paycheckBudgets : data.monthlyBudgets;
    const budget = parseFloat(budgetSource?.[_mk]?.categories?.[cat] || 0);
    const totalFinal = catBills.reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
    const max = Math.max(budget, totalFinal, 1);
    const expPct = Math.min((totalFinal / max) * 100, 100);
    const paidPct = Math.min((totalPaid / max) * 100, 100);

    const R = 66;
    const CX = 90;
    const CY = 90;
    const SW = 30;
    const CIRC = 2 * Math.PI * R;
    let donutSegments = "";
    let legendItems = "";
    let offset = 0;

    const refundMap = {};
    const standaloneRefunds = [];
    refunds.forEach(r => {
        const match = payments.find(p => p.name.trim().toLowerCase() === r.name.trim().toLowerCase());
        if (match) {
            if (!refundMap[match.id]) refundMap[match.id] = 0;
            if (r.paid) refundMap[match.id] += parseFloat(getBillDisplayAmount(r)) || 0;
        } else {
            standaloneRefunds.push(r);
        }
    });

    const GAP = 1.5;
    const greyShades = ["#b0b0b0", "#c0c0c0", "#d0d0d0", "#dedede", "#ebebeb", "#f5f5f5", "#fafafa"];
    const overdueShades = ["#ff8888", "#ff9999", "#ffaaaa", "#ffbbbb", "#ffcccc", "#ffdede", "#ffeeee"];

    if (payments.length === 0) {
        donutSegments = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e0e0e0" stroke-width="${SW}"/>`;
    } else {
        const allSegments = payments.map(bill => {
            const amt = parseFloat(getBillDisplayAmount(bill)) || 0;
            const refunded = refundMap[bill.id] || 0;
            const net = Math.max(0, amt - refunded);
            return { bill, net };
        }).filter(s => s.net > 0).sort((a, b) => b.net - a.net);

        const MAX_SLICES = 6;
        const billSegments = allSegments.slice(0, MAX_SLICES);
        const othersSegments = allSegments.slice(MAX_SLICES);
        const othersNet = othersSegments.reduce((s, seg) => s + seg.net, 0);
        if (othersNet > 0) billSegments.push({ bill: null, net: othersNet, isOthers: true });

        const totalNet = billSegments.reduce((s, seg) => s + seg.net, 0);

        if (totalNet <= 0) {
            donutSegments = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e0e0e0" stroke-width="${SW}"/>`;
        } else {
            let paidIndex = 0;
            let greyIndex = 0;
            let overdueIndex = 0;

            billSegments.forEach(({ bill, net, isOthers }) => {
                const status = isOthers ? "other" : getBillStatus(bill);
                let shade;
                if (isOthers) {
                    const allPaid = othersSegments.every(s => getBillStatus(s.bill) === "paid");
                    const anyOverdue = othersSegments.some(s => getBillStatus(s.bill) === "overdue");
                    shade = allPaid ? color.shades[5] : anyOverdue ? overdueShades[6] : greyShades[5];
                } else if (status === "paid") {
                    shade = color.shades[paidIndex % color.shades.length];
                    paidIndex++;
                } else if (status === "overdue") {
                    shade = overdueShades[overdueIndex % overdueShades.length];
                    overdueIndex++;
                } else {
                    shade = greyShades[greyIndex % greyShades.length];
                    greyIndex++;
                }

                const pct = net / totalNet;
                const dash = pct * CIRC;
                const billPct = Math.round(pct * 100);

                donutSegments += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${shade}" stroke-width="${SW}" stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${CX} ${CY})" stroke-linecap="butt"/>`;

                const midAngle = ((offset + dash / 2) / CIRC) * 2 * Math.PI - Math.PI / 2;
                const lx = (CX + R * Math.cos(midAngle)).toFixed(1);
                const ly = (CY + R * Math.sin(midAngle)).toFixed(1);
                if (billPct >= 6) {
                    const labelColor = "#666"; status === "overdue" ? "#cc0000" : isOthers ? (shade === color.shades[5] ? "#037c7c" : shade === overdueShades[6] ? "#cc0000" : "#888") : "#888";
                    donutSegments += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="600" fill="${labelColor}">${billPct}%</text>`;
                }

                legendItems += `
                    <div class="mi-dl-item">
                        <div class="mi-dl-dot" style="background:${shade};"></div>
                        <span class="mi-dl-name">${isOthers ? `Others (${othersSegments.length})` : bill.name}</span>
                    </div>`;

                offset += dash;
            });

            if (billSegments.length > 1) {
                let gapOffset = 0;
                billSegments.forEach(({ net }) => {
                    const dash = (net / totalNet) * CIRC;
                    gapOffset += dash;
                    const angle = (gapOffset / CIRC) * 2 * Math.PI - Math.PI / 2;
                    const x1 = (CX + (R - SW / 2) * Math.cos(angle)).toFixed(1);
                    const y1 = (CY + (R - SW / 2) * Math.sin(angle)).toFixed(1);
                    const x2 = (CX + (R + SW / 2) * Math.cos(angle)).toFixed(1);
                    const y2 = (CY + (R + SW / 2) * Math.sin(angle)).toFixed(1);
                    donutSegments += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${GAP}" stroke-linecap="round"/>`;
                });
            }
        }
    }

    let pill1Class = "mi-pill-neutral";
    let pill1Val = "Set a budget to track planning";
    if (idx === 0) {
        pill1Val = "Set an expected income to track";
        if (budget > 0) {
            const room = budget - totalFinal;
            if (totalFinal === 0) { pill1Class = "mi-pill-neutral"; pill1Val = "No income planned yet"; }
            else if (room > 0) { pill1Class = "mi-pill-yellow"; pill1Val = `${formatMoney(room)} below expected`; }
            else if (room === 0) { pill1Class = "mi-pill-green"; pill1Val = "Expected income fully planned"; }
            else { pill1Class = "mi-pill-green"; pill1Val = `${formatMoney(Math.abs(room))} over expected`; }
        }
    } else if (idx === 1) {
        pill1Val = "Set a savings goal to track";
        if (budget > 0) {
            const room = budget - totalFinal;
            if (totalFinal === 0) { pill1Class = "mi-pill-neutral"; pill1Val = "No savings planned yet"; }
            else if (room > 0) { pill1Class = "mi-pill-yellow"; pill1Val = `${formatMoney(room)} below savings goal`; }
            else if (room === 0) { pill1Class = "mi-pill-green"; pill1Val = "Savings goal fully planned"; }
            else { pill1Class = "mi-pill-green"; pill1Val = `${formatMoney(Math.abs(room))} over savings goal`; }
        }
    } else {
        if (budget > 0) {
            const room = budget - totalFinal;
            if (room > 0) { pill1Class = "mi-pill-green"; pill1Val = `You can still plan ${formatMoney(room)} more`; }
            else if (room === 0) { pill1Class = "mi-pill-green"; pill1Val = "Budget fully allocated"; }
            else { pill1Class = "mi-pill-red"; pill1Val = `${formatMoney(Math.abs(room))} over budget`; }
        }
    }

    const pill2Class = payments.length === 0 ? "mi-pill-neutral" : totalLeftToPay <= 0 ? "mi-pill-green" : "mi-pill-yellow";
    const pill2Val = payments.length === 0 ? `No ${cat} this month` : totalLeftToPay <= 0 ? (idx === 0 ? "All received ✓" : idx === 1 ? "All saved ✓" : "All paid ✓") : (idx === 0 ? `${formatMoney(totalLeftToPay)} left to receive` : idx === 1 ? `${formatMoney(totalLeftToPay)} left to save` : `${formatMoney(totalLeftToPay)} left to pay`);

    // Grupăm payments după nume pentru tabel
    const paymentGroups = {};
    payments.forEach(bill => {
        const key = bill.name.trim().toLowerCase();
        if (!paymentGroups[key]) {
            paymentGroups[key] = {
                name: bill.name,
                totalExp: 0,
                totalPaid: 0,
                count: 0
            };
        }
        const expAmt = parseFloat(bill.amount) || 0;
        const refundedAmt = refundMap[bill.id] || 0;
        const displayAmt = parseFloat(getBillDisplayAmount(bill)) || 0;
        paymentGroups[key].totalExp += expAmt;
        if (bill.paid) paymentGroups[key].totalPaid += Math.max(0, displayAmt - refundedAmt);
        paymentGroups[key].count++;
    });

    const groupsSorted = Object.values(paymentGroups).sort((a, b) => b.totalExp - a.totalExp);
    const paymentRows = groupsSorted.map(g => `
            <tr>
                <td><div class="mi-td-name" style="color:${color.text};">${g.name}${g.count > 1 ? ` <span style="font-size:11px;color:var(--muted);">×${g.count}</span>` : ""}</div></td>
                <td class="mi-td-exp">${formatMoney(g.totalExp)}</td>
                <td style="color:${g.totalPaid > 0 ? color.text : "var(--line)"};">${g.totalPaid > 0 ? formatMoney(g.totalPaid) : "—"}</td>
            </tr>`);

    const refundRows = standaloneRefunds.map(bill => {
        const amt = parseFloat(getBillDisplayAmount(bill)) || 0;
        return `
            <tr>
                <td><div class="mi-td-name" style="color:${color.text};">${bill.name}</div></td>
                <td class="mi-td-exp">&#x27A1; ${formatMoney(parseFloat(bill.amount) || 0)}</td>
                <td style="color:${bill.paid ? "var(--priority-4-color)" : "var(--line)"};white-space:nowrap;">${bill.paid ? `&#x27A1; ${formatMoney(amt)}` : "—"}</td>
            </tr>`;
    });

    const tableRows = payments.length > 0 || standaloneRefunds.length > 0
        ? [...paymentRows, ...refundRows].join("")
        : `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:16px;">No ${cat} this month</td></tr>`;

    const monthName = new Date(year, month).toLocaleString("default", { month: "short" });

    return `
        <div class="mi-cat-card">
            <div class="mi-cat-header" style="background:${color.main};">
                <div class="mi-cat-header-name">${cat}</div>
            </div>

            <div class="mi-budget-section" style="background:${color.soft};">
                <div class="mi-budget-top-row">
                    <span class="mi-budget-label" style="color:${color.text};">${(() => {
    if (idx === 0) return `<span class="help-icon" data-help-title="Expected Income — How it works" data-help="Enter your expected total income for this month. Use this to compare against your actual received income." style="cursor:pointer;margin-right:6px;">📈</span>Expected Income`;
    if (idx === 1) return `<span class="help-icon" data-help-title="Savings Goal — How it works" data-help="Enter your savings goal for this month. Use this to compare against your actual saved amount." style="cursor:pointer;margin-right:6px;">🎯</span>Savings Goal`;
    return `<span class="help-icon" data-help-title="Monthly Budget — How it works" data-help="Set a monthly budget for this category to track your spending.&lt;br&gt;&lt;br&gt;The progress bar shows how much of your budget has been allocated (actual) and how much has already been paid." style="cursor:pointer;margin-right:6px;">💰</span>Monthly Budget`;
})()}</span>
                    <div class="mi-budget-input-row">
                        ${data.settings.currencyPosition !== "after" ? `<span class="mi-budget-prefix" style="color:${color.text};">${String(data.settings.currencySymbol || "$").split("|")[0]}</span>` : ""}                      
                        <input class="mi-budget-input" type="number" placeholder="—"
                            style="color:${color.inputColor};border-color:${color.border};"
                            value="${budget ? budget.toFixed(2) : ""}"
                            data-cat="${cat}"
                            oninput="saveCategoryBudget(this)" onblur="saveCategoryBudgetOnBlur(this)" onkeydown="if(event.key==='Enter')this.blur()" autocomplete="off" autocorrect="off" autocapitalize="off"
                            >
                        ${data.settings.currencyPosition === "after" ? `<span class="mi-budget-prefix" style="color:${color.text};">${String(data.settings.currencySymbol || "$").split("|")[0]}</span>` : ""}
                    </div>
                </div>
                <div class="mi-bar-track">
                    <div class="mi-bar-exp" style="width:${expPct}%;background:${budget > 0 && totalFinal > budget ? "var(--red-soft)" : color.main};"></div>
                    <div class="mi-bar-paid" style="width:${paidPct}%;background:${color.shades[0]};"></div>
                </div>
                <div class="mi-bar-labels">
                    <span style="display:inline-flex;flex-direction:column;gap:2px;align-items:center;"><span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color.shades[0]};"></span>${idx === 0 ? "received" : idx === 1 ? "saved" : "paid"}</span><strong style="color:${color.text};">${formatMoney(totalPaid)}</strong></span>
                    <span style="display:inline-flex;flex-direction:column;gap:2px;align-items:center;"><span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${budget > 0 && (idx === 0 || idx === 1) ? (totalFinal >= budget ? color.main : "var(--red-soft)") : (budget > 0 && totalFinal > budget ? "var(--red-soft)" : color.main)};opacity:0.65;"></span>actual</span><strong style="color:${budget > 0 && (idx === 0 || idx === 1) ? (totalFinal >= budget ? color.text : "var(--red)") : (budget > 0 && totalFinal > budget ? "var(--red)" : color.text)};">${formatMoney(totalFinal)}</strong></span>
                    <span style="display:inline-flex;flex-direction:column;gap:2px;align-items:center;"><span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--bar-expected-light);"></span>${idx === 0 ? "expected" : idx === 1 ? "goal" : "budget"}</span><strong style="color:var(--muted);">${budget ? formatMoney(budget) : "—"}</strong></span>
                </div>
                <div class="mi-pills">
                    <div class="mi-pill ${pill1Class}"><span class="mi-pill-val">${pill1Val}</span></div>
                    <div class="mi-pill ${pill2Class}"><span class="mi-pill-val">${pill2Val}</span></div>
                </div>
                </div>

            <div class="mi-donut-section">
                <svg viewBox="0 0 180 180" role="img" class="mi-donut-svg" aria-label="${cat} breakdown">
                    ${donutSegments}
                    <text x="${CX}" y="${CY - 6}" text-anchor="middle" font-size="15" font-weight="700" fill="${color.inputColor}">${monthName}</text>
                    <text x="${CX}" y="${CY + 10}" text-anchor="middle" font-size="11" fill="#999">${cat.split(" ")[0].toUpperCase()}</text>
                </svg>
                <div class="mi-donut-legend">${legendItems || `<span style="font-size:11px;color:var(--muted);">No ${cat} this month</span>`}</div>
            </div>

            <div class="mi-table-scroll" style="background:${color.tableBg};">
                <table class="mi-cat-table">
                    <thead style="background:${color.soft};"><tr><th>Name</th><th>Expected</th><th>Paid</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <table class="mi-cat-table mi-cat-total">
                <tfoot style="background:${color.soft};">
                    <tr>
                        <td class="mi-cat-total-label">Total</td>
                        <td class="mi-cat-total-exp">${formatMoney(totalExp)}</td>
                        <td class="mi-cat-total-paid" style="color:${color.text};">${formatMoney(totalPaid)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

let _budgetSaveTimer = null;
function saveCategoryBudget(input) {
    const cat = input.dataset.cat;
    const isEmpty = input.value.trim() === "";
    const val = parseFloat(input.value) || 0;
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    if (!data.monthlyBudgets) data.monthlyBudgets = {};
    if (!data.monthlyBudgets[mk]) data.monthlyBudgets[mk] = {};
    if (!data.monthlyBudgets[mk].categories) data.monthlyBudgets[mk].categories = {};

    if (isEmpty || val === 0) {
        delete data.monthlyBudgets[mk].categories[cat];
    } else {
        data.monthlyBudgets[mk].categories[cat] = val;
    }

    clearTimeout(_budgetSaveTimer);
    _budgetSaveTimer = setTimeout(() => {
        saveData();
    }, 800);
}

function saveCategoryBudgetOnBlur(input) {
    clearTimeout(_budgetSaveTimer);
    const cat = input.dataset.cat;
    const isEmpty = input.value.trim() === "";
    const val = parseFloat(input.value) || 0;
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    if (!data.monthlyBudgets) data.monthlyBudgets = {};
    if (!data.monthlyBudgets[mk]) data.monthlyBudgets[mk] = {};
    if (!data.monthlyBudgets[mk].categories) data.monthlyBudgets[mk].categories = {};

    if (isEmpty || val === 0) {
        delete data.monthlyBudgets[mk].categories[cat];
    } else {
        data.monthlyBudgets[mk].categories[cat] = val;
    }

    saveData();
    renderMonthlyInsights();
}

function renderMonthlyNotes() {
    const el = document.getElementById("monthlyNotes");
    if (!el) return;
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    const key = `notes_${year}_${month}`;
    const saved = data.monthlyNotes?.[key] || "";
    const monthName = new Date(year, month).toLocaleString("default", { month: "long" });
    el.innerHTML = `
        <div class="monthly-notes-sticky">
            <div class="monthly-notes-pin">📌</div>
            <div class="monthly-notes-title">This month's thoughts · ${monthName} ${year}</div>
            <div class="monthly-notes-line">
                <textarea class="monthly-notes-textarea" oninput="saveMonthlyNote(this, '${key}')">${saved}</textarea>
            </div>
            <div class="monthly-notes-footer" id="notes-saved-${key}"></div>
        </div>`;
    const ta = el.querySelector("textarea");
    if (ta) setTimeout(() => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }, 0);
}

function renderYearlyNotes() {
    const el = document.getElementById("yearlyNotes");
    if (!el) return;
    const year = currentCalendarDate.getFullYear();
    const key = `notes_${year}_yearly`;
    const saved = data.monthlyNotes?.[key] || "";
    el.innerHTML = `
        <div class="monthly-notes-sticky">
            <div class="monthly-notes-pin">📌</div>
            <div class="monthly-notes-title">This year's thoughts · ${year}</div>
            <div class="monthly-notes-line">
                <textarea class="monthly-notes-textarea" oninput="saveYearlyNote(this, '${key}')">${saved}</textarea>
            </div>
            <div class="monthly-notes-footer" id="notes-saved-${key}"></div>
        </div>`;
    const ta = el.querySelector("textarea");
    if (ta) setTimeout(() => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }, 0);
}

let _notesSaveTimer = null;
function saveYearlyNote(textarea, key) {
    if (!data.monthlyNotes) data.monthlyNotes = {};
    data.monthlyNotes[key] = textarea.value;
    clearTimeout(_notesSaveTimer);
    _notesSaveTimer = setTimeout(() => saveData(), 1000);
}

function saveMonthlyNote(textarea, key) {
    if (!data.monthlyNotes) data.monthlyNotes = {};
    data.monthlyNotes[key] = textarea.value;
    clearTimeout(_notesSaveTimer);
    _notesSaveTimer = setTimeout(() => saveData(), 1000);
}

function saveAllBudget(input) {
    const val = parseFloat(input.value) || 0;
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    if (!data.monthlyBudgets) data.monthlyBudgets = {};
    if (!data.monthlyBudgets[mk]) data.monthlyBudgets[mk] = {};
    if (val === 0) {
        delete data.monthlyBudgets[mk].total;
    } else {
        data.monthlyBudgets[mk].total = val;
    }
    clearTimeout(_budgetSaveTimer);
    _budgetSaveTimer = setTimeout(() => {
        saveData();
    }, 800);
}

function saveAllBudgetOnBlur(input) {
    clearTimeout(_budgetSaveTimer);
    const val = parseFloat(input.value) || 0;
    const month = currentCalendarDate.getMonth();
    const year = currentCalendarDate.getFullYear();
    const mk = `${year}-${String(month + 1).padStart(2, "0")}`;
    if (!data.monthlyBudgets) data.monthlyBudgets = {};
    if (!data.monthlyBudgets[mk]) data.monthlyBudgets[mk] = {};
    if (val === 0) {
        delete data.monthlyBudgets[mk].total;
    } else {
        data.monthlyBudgets[mk].total = val;
    }
    saveData();
    renderMonthlyInsights();
}

function loadPaycheckSettings() {
    const ps = data.paycheckSettings || {};
    if (els.paycheckFrequency) els.paycheckFrequency.value = ps.frequency || "custom";
    if (els.paycheckStartDate) {
        els.paycheckStartDate.value = ps.startDate || "";
        if (!ps.startDate) els.paycheckStartDate.type = "text", els.paycheckStartDate.type = "date";
    }
    if (els.paycheckNamePrefix) els.paycheckNamePrefix.value = ps.namePrefix || "Paycheck";
    if (els.highlightPaycheckCalendar) els.highlightPaycheckCalendar.value = ps.highlightCalendar || "yes";
    const semiDay1 = document.getElementById("paycheckSemiDay1");
    const semiDay2 = document.getElementById("paycheckSemiDay2");
    const semiStart = document.getElementById("paycheckSemiStartMonth");
    if (semiDay1) semiDay1.value = ps.semiDay1 || "";
    if (semiDay2) semiDay2.value = ps.semiDay2 || "";
    if (semiStart) semiStart.value = ps.semiStartMonth || "";
    const monthlyDay = document.getElementById("paycheckMonthlyDay");
    if (monthlyDay) monthlyDay.value = ps.monthlyDay || "";
    updatePaycheckSetupVisibility();
}

function updatePaycheckSetupVisibility() {
    const freq = data.paycheckSettings?.frequency || "custom";
    const isAuto = freq !== "custom";
    const isSemi = freq === "semimonthly";
    const isMonthly = freq === "monthly";
    document.getElementById("paycheckStartDateWrap").style.display = isAuto ? "" : "none";
    document.getElementById("paycheckNameWrap").style.display = isAuto ? "" : "none";
    document.getElementById("paycheckGenerateWrap").style.display = isAuto ? "" : "none";
    const deleteAllWrap = document.getElementById("deleteAllPaychecksWrap");
    if (deleteAllWrap) deleteAllWrap.style.display = (data.paychecks?.length > 0) ? "" : "none";
    document.getElementById("paycheckMonthlyWrap").style.display = isMonthly ? "" : "none";
    document.getElementById("paycheckSemiMonthlyWrap").style.display = isSemi ? "" : "none";
    document.getElementById("paycheckSemiMonthlyWrap2").style.display = isSemi ? "" : "none";
}

function generatePaychecks() {
    const ps = data.paycheckSettings || {};
    const freq = ps.frequency;
    const startDateStr = ps.startDate;
    const namePrefix = ps.namePrefix || "Paycheck";

    if (!startDateStr) { alert("Please set a start date first."); return; }
    if (freq === "custom") return;

    const start = parseLocalDate(startDateStr);
    start.setHours(0, 0, 0, 0);

    if (freq === "semimonthly") {
        const d1 = parseInt(ps.semiDay1) || 1;
        const d2 = parseInt(ps.semiDay2) || 15;
        const day = start.getDate();
        if (day < d1) {
            start.setDate(d1);
        } else if (day > d1 && day < d2) {
            start.setDate(d2);
        }
    } else if (freq === "monthly") {
        const d1 = parseInt(ps.monthlyDay) || 1;
        const day = start.getDate();
        if (day < d1) {
            start.setDate(d1);
        } else if (day > d1) {
            start.setMonth(start.getMonth() + 1);
            start.setDate(d1);
        }
    }

    const existing = data.paychecks || [];
    const affected = existing.filter(pc => {
        const pcEnd = parseLocalDate(pc.endDate);
        return pcEnd >= start;
    });

    if (affected.length > 0) {
        const confirmed = confirm(`Paychecks from ${startDateStr} onward will be replaced. Any budget data for those periods will be lost. Continue?`);
        if (!confirmed) return;
    }

    const dayBefore = new Date(start);
    dayBefore.setDate(dayBefore.getDate() - 1);

    const kept = existing.filter(pc => {
        const pcEnd = parseLocalDate(pc.endDate);
        return pcEnd < start;
    });

    const overlapping = existing.find(pc => {
        const pcStart = parseLocalDate(pc.startDate);
        const pcEnd = parseLocalDate(pc.endDate);
        return pcStart < start && pcEnd >= start;
    });
    if (overlapping) {
        kept.push({ ...overlapping, endDate: toLocalDateInputValue(dayBefore) });
    }

    const removedIds = affected.map(pc => pc.id);
    removedIds.forEach(id => {
        if (data.paycheckBudgets?.[id]) delete data.paycheckBudgets[id];
        if (data.monthlyNotes?.[`notes_paycheck_${id}`]) delete data.monthlyNotes[`notes_paycheck_${id}`];
    });

    const endLimit = new Date(start.getFullYear(), 11, 31);
    const newPaychecks = [];
    let current = new Date(start);
    let counter = kept.length + 1;

    while (current <= endLimit) {
        let periodEnd;

        if (freq === "weekly") {
            periodEnd = new Date(current);
            periodEnd.setDate(periodEnd.getDate() + 6);
        } else if (freq === "biweekly") {
            periodEnd = new Date(current);
            periodEnd.setDate(periodEnd.getDate() + 13);
        } else if (freq === "semimonthly") {
            const d1 = parseInt(ps.semiDay1) || 1;
            const d2 = parseInt(ps.semiDay2) || 15;
            if (current.getDate() < d2) {
                periodEnd = new Date(current.getFullYear(), current.getMonth(), d2 - 1);
            } else {
                periodEnd = new Date(current.getFullYear(), current.getMonth() + 1, d1 - 1);
            }
        } else if (freq === "monthly") {
            const d1 = parseInt(ps.monthlyDay) || 1;
            periodEnd = new Date(current.getFullYear(), current.getMonth() + 1, d1 - 1);
        }

        newPaychecks.push({
            id: crypto.randomUUID(),
            name: `${namePrefix} ${counter}`,
            startDate: toLocalDateInputValue(current),
            endDate: toLocalDateInputValue(periodEnd)
        });

        counter++;

        if (freq === "weekly" || freq === "biweekly") {
            current = new Date(periodEnd);
            current.setDate(current.getDate() + 1);
        } else if (freq === "semimonthly") {
            const d1 = parseInt(ps.semiDay1) || 1;
            const d2 = parseInt(ps.semiDay2) || 15;
            if (current.getDate() < d2) {
                current = new Date(current.getFullYear(), current.getMonth(), d2);
            } else {
                current = new Date(current.getFullYear(), current.getMonth() + 1, d1);
            }
        } else if (freq === "monthly") {
            const d1 = parseInt(ps.monthlyDay) || 1;
            current = new Date(current.getFullYear(), current.getMonth() + 1, d1);
        }
    }

    data.paychecks = [...kept, ...newPaychecks];
    ps.startDate = toLocalDateInputValue(current);
    if (els.paycheckStartDate) els.paycheckStartDate.value = ps.startDate;
    saveData();
    updatePaycheckSetupVisibility();
    if (typeof resetPaycheckInitialized === "function") resetPaycheckInitialized();
    const keptMsg = kept.length > 0 ? ` ${kept.length} previous paychecks kept.` : "";
    alert(`${newPaychecks.length} paychecks generated.${keptMsg}\n\nYou can view them in the dropdown at the top of the Paycheck Budget page.`);
}

window.generatePaychecks = generatePaychecks;

function isPaycheckKey(mk) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mk);
}


function showBudgetWarning(msg) {
    let w = document.getElementById("budget-warning-toast");
    if (!w) {
        w = document.createElement("div");
        w.id = "budget-warning-toast";
        document.body.appendChild(w);
    }
    w.textContent = msg;
    w.className = "budget-warning-toast show";
    clearTimeout(w._t);
    w._t = setTimeout(() => w.classList.remove("show"), 3000);
}

function renderYearlySummary() {
    const el = document.getElementById("categoryBreakdownYearly");
    if (!el) return;

    const year = currentCalendarDate.getFullYear();

    const yearBills = data.bills.filter(bill => {
        const d = parseLocalDate(bill.dueDate);
        return d.getFullYear() === year;
    });

    const catColors = [
        { main: "#77dddb", shades: ["#4ecece", "#77dddb", "#9de8e7", "#b8efee", "#cdf4f3", "#dff8f8"], soft: "var(--mint-soft-2)", soft3: "var(--mint-soft-3)", tableBg: "rgba(116, 255, 253, 0.06)", text: "var(--mint-text)", border: "#9ce4e3", inputColor: "var(--mint-dark, #025e5e)" },
        { main: "#d299dc", shades: ["#c285d0", "#d299dc", "#ddb0e8", "#eaccf2", "#f5e5f9", "#faf0fc"], soft: "var(--purple-soft-2)", soft3: "var(--purple-soft-3)", tableBg: "rgba(210,153,220,0.06)", text: "var(--purple-text)", border: "#ddb0e8", inputColor: "var(--purple-text)" },
        { main: "#ffcf5f", shades: ["#f0b830", "#ffcf5f", "#ffe08a", "#ffedb3", "#fff7d9", "#fffdf0"], soft: "var(--yellow-soft-2)", soft3: "var(--yellow-soft-3)", tableBg: "rgba(255,207,95,0.06)", text: "var(--yellow-text)", border: "#ffe08a", inputColor: "var(--yellow-text)" },
        { main: "#fea969", shades: ["#f08848", "#fea969", "#ffc090", "#ffd4b5", "#ffeada", "#fff5ee"], soft: "var(--orange-soft-2)", soft3: "var(--orange-soft-3)", tableBg: "rgba(254,169,105,0.06)", text: "var(--orange-text)", border: "#ffd0a0", inputColor: "var(--orange-text)" },
        { main: "#fe7aa7", shades: ["#f06090", "#fe7aa7", "#ffaac8", "#ffcbde", "#ffe5ef", "#fff5f8"], soft: "var(--pink-soft-2)", soft3: "var(--pink-soft-3)", tableBg: "rgba(254,122,167,0.06)", text: "var(--pink-text)", border: "#ffb0cc", inputColor: "var(--pink-text)" }
    ];

    if (!yearBills.length) {
        renderYearlyNotes();
    }

    renderYearlyNotes();

    const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    el.className = "";

    const monthlySection = renderYearlySummaryCard(catColors, yearBills, year) + data.categories.map((cat, idx) => {
        const color = catColors[idx % catColors.length];
        return renderYearlyMonthlyCard(cat, color, yearBills, year);
    }).join("");

    const categorySection = renderYearlyTop5Card(catColors, yearBills, year) + data.categories.map((cat, idx) => {
        const color = catColors[idx % catColors.length];
        return renderYearlyCategoryCard(cat, color, yearBills, year);
    }).join("");

    el.innerHTML = `
        <div class="yearly-monthly-section">${monthlySection}</div>
        <div class="yearly-category-section">${categorySection}</div>
    `;

}

function renderYearlySummaryCard(catColors, yearBills, year) {
    const R = 66, CX = 90, CY = 90, SW = 30, CIRC = 2 * Math.PI * R;
    const GAP = 1.5;

    const catData = data.categories.map((cat, idx) => {
        const color = catColors[idx % catColors.length];
        const catBills = yearBills.filter(b => b.category === cat);
        const payments = catBills.filter(b => b.type !== "refund");
        const totalExp = catBills.reduce((s, b) => b.type === "refund" ? s - (parseFloat(b.amount) || 0) : s + (parseFloat(b.amount) || 0), 0);
        const totalPaid = catBills.filter(b => b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
        return { cat, color, totalExp, totalPaid, payments };
    });

    const spendingData = catData.filter((_, idx) => idx !== 0);
    const grandExp = spendingData.reduce((s, c) => s + c.totalExp, 0);
    const grandPaid = spendingData.reduce((s, c) => s + c.totalPaid, 0);

    const max = Math.max(grandExp, 1);
    const expPct = Math.min((grandExp / max) * 100, 100);
    const paidPct = Math.min((grandPaid / max) * 100, 100);

    const donutData = catData.filter((_, idx) => idx !== 0);
    let donutSegments = "", legendItems = "", offset = 0;
    const totalNet = donutData.reduce((s, c) => s + c.totalExp, 0);
    if (totalNet <= 0) {
        donutSegments = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e0e0e0" stroke-width="${SW}"/>`;
    } else {
        donutData.forEach(({ cat, color, totalExp: net }) => {
            if (net <= 0) return;
            const pct = net / totalNet;
            const dash = pct * CIRC;
            const billPct = Math.round(pct * 100);
            donutSegments += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color.main}" stroke-width="${SW}" stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${CX} ${CY})" stroke-linecap="butt"/>`;
            if (billPct >= 6) {
                const midAngle = ((offset + dash / 2) / CIRC) * 2 * Math.PI - Math.PI / 2;
                const lx = (CX + R * Math.cos(midAngle)).toFixed(1);
                const ly = (CY + R * Math.sin(midAngle)).toFixed(1);
                donutSegments += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="600" fill="#666">${billPct}%</text>`;
            }
            legendItems += `<div class="mi-dl-item"><div class="mi-dl-dot" style="background:${color.main};"></div><span class="mi-dl-name" style="color:${color.text};text-transform:uppercase;">${cat}</span></div>`;
            offset += dash;
        });
        let gapOffset = 0;
        donutData.forEach(({ totalExp: net }) => {
            if (net <= 0) return;
            const dash = (net / totalNet) * CIRC;
            gapOffset += dash;
            const angle = (gapOffset / CIRC) * 2 * Math.PI - Math.PI / 2;
            const x1 = (CX + (R - SW / 2) * Math.cos(angle)).toFixed(1);
            const y1 = (CY + (R - SW / 2) * Math.sin(angle)).toFixed(1);
            const x2 = (CX + (R + SW / 2) * Math.cos(angle)).toFixed(1);
            const y2 = (CY + (R + SW / 2) * Math.sin(angle)).toFixed(1);
            donutSegments += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${GAP}" stroke-linecap="round"/>`;
        });
    }

    const tableRows = catData.map(({ cat, color, totalExp, totalPaid }) => `
        <tr>
            <td><div class="mi-td-name" style="color:${color.text};text-transform:uppercase;">${cat}</div></td>
            <td class="mi-td-exp">${formatMoney(totalExp)}</td>
            <td style="color:${color.text};">${formatMoney(totalPaid)}</td>
        </tr>`).join("");

    return `
        <div class="mi-cat-card">
            <div class="mi-cat-header" style="background:var(--peach);">
                <div class="mi-cat-header-name">${year} BREAKDOWN</div>
            </div>
            <div style="background:var(--white);padding:12px 10px 8px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);">
                <div class="mi-bar-chart-title">EXPECTED VS PAID BY CATEGORY IN ${year}</div>
                ${(() => {
            const maxVal = Math.max(...catData.map(c => Math.max(c.totalExp, c.totalPaid)), 1);
            return catData.map(({ cat, color, totalExp, totalPaid }) => {
                const expW = Math.min((totalExp / maxVal) * 100, 100).toFixed(1);
                const paidW = Math.min((totalPaid / maxVal) * 100, 100).toFixed(1);
                return `<div class="mi-bar-duo-group">
                            <div class="mi-bar-duo-label" style="color:${color.text};">${cat}</div>
                            <div class="mi-bar-duo-bars">
                                <div class="mi-bar-duo-row"><div class="mi-bar-duo" style="width:${expW}%;background:var(--bar-expected);"></div></div>
                                <div class="mi-bar-duo-row"><div class="mi-bar-duo" style="width:${paidW}%;background:${color.main};"></div></div>
                            </div>
                        </div>`;
            }).join('');
        })()}
                <div class="mi-bar-duo-legend yearly-bar-duo-legend">
                    <span><span class="mi-bar-duo-dot" style="background:var(--bar-expected);"></span>Expected</span>
                    <span><span class="mi-bar-duo-dot" style="background:var(--peach);"></span>Paid</span>
                </div>
            </div>
            <div style="background:var(--peach-soft-2);padding:22px 16px;border-bottom:2px solid var(--line);display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center;">
                <div style="font-size:12px;color:var(--muted);font-weight:600;">
                    <span class="help-icon" data-help-title="Planned vs Paid" data-help="Includes Savings, Bills, Expenses and Debt Payments. Income is excluded." style="cursor:pointer;margin-right:4px;">📊</span>planned <strong style="color:var(--peach-text);">${formatMoney(grandExp)}</strong> · paid <strong style="color:var(--peach-text);">${formatMoney(grandPaid)}</strong>
                </div>
                <div style="font-size:13px;font-weight:800;color:${grandPaid > grandExp ? 'var(--red)' : 'var(--priority-4-color)'};">
                    ${grandPaid > grandExp
            ? `${Math.round(((grandPaid - grandExp) / grandExp) * 100)}% over planned`
            : grandPaid < grandExp
                ? `${Math.round(((grandExp - grandPaid) / grandExp) * 100)}% under planned ✓`
                : `on target ✓`}
                </div>
            </div>
            <div class="mi-donut-section">
                <svg viewBox="0 0 180 180" role="img" class="mi-donut-svg" aria-label="YEARLY BREAKDOWN">
                    ${donutSegments}
                    <text x="${CX}" y="${CY - 6}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--peach-text)">${year}</text>
                    <text x="${CX}" y="${CY + 10}" text-anchor="middle" font-size="11" fill="#999">BREAKDOWN</text>
                </svg>
                <div class="mi-donut-legend">${legendItems || '<span style="font-size:11px;color:var(--muted);">No transactions this year</span>'}</div>
            </div>
            <div class="mi-table-scroll mi-table-summary" style="background:var(--peach-soft-3);">
                <table class="mi-cat-table">
                    <thead style="background:var(--peach-soft-2);"><tr><th>Category</th><th>Expected</th><th>Paid</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            </div>`;
}

function renderYearlyTop5Card(catColors, yearBills, year) {
    const R = 66, CX = 90, CY = 90, SW = 30, CIRC = 2 * Math.PI * R;
    const GAP = 1.5;

    const spendingCats = data.categories.slice(2);
const payments = yearBills.filter(b => b.paid && spendingCats.includes(b.category));

    // Grupăm după nume și sumăm paid
    const groups = {};
    payments.forEach(bill => {
        const key = bill.name.trim().toLowerCase();
        if (!groups[key]) {
            groups[key] = {
                name: bill.name,
                totalPaid: 0,
                totalExp: 0,
                category: bill.category
            };
        }
        const amt = parseFloat(getBillDisplayAmount(bill)) || 0;
        groups[key].totalPaid += bill.type === "refund" ? -amt : amt;
        groups[key].totalExp += bill.type === "refund" ? 0 : (parseFloat(bill.amount) || 0);
    });

    const top5 = Object.values(groups)
        .sort((a, b) => b.totalPaid - a.totalPaid)
        .slice(0, 5);

    const grandPaid = top5.reduce((s, g) => s + g.totalPaid, 0);
    const grandExp = top5.reduce((s, g) => s + g.totalExp, 0);

    // Donut
    const peachShades = ["#fab8be", "#ffc5cb", "#ffd4d8", "#ffe5e8", "#fff0f2"];
    let donutSegments = "", legendItems = "", offset = 0;
    const totalNet = grandPaid;

    if (totalNet <= 0) {
        donutSegments = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e0e0e0" stroke-width="${SW}"/>`;
    } else {
        top5.forEach((g, i) => {
            if (g.totalPaid <= 0) return;
            const shade = peachShades[i % peachShades.length];
            const pct = g.totalPaid / totalNet;
            const dash = pct * CIRC;
            const billPct = Math.round(pct * 100);
            donutSegments += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${shade}" stroke-width="${SW}" stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${CX} ${CY})" stroke-linecap="butt"/>`;
            if (billPct >= 6) {
                const midAngle = ((offset + dash / 2) / CIRC) * 2 * Math.PI - Math.PI / 2;
                const lx = (CX + R * Math.cos(midAngle)).toFixed(1);
                const ly = (CY + R * Math.sin(midAngle)).toFixed(1);
                donutSegments += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="600" fill="#666">${billPct}%</text>`;
            }
            legendItems += `<div class="mi-dl-item"><div class="mi-dl-dot" style="background:${shade};"></div><span class="mi-dl-name">${g.name}</span></div>`;
            offset += dash;
        });

        let gapOffset = 0;
        top5.forEach(g => {
            if (g.totalPaid <= 0) return;
            const dash = (g.totalPaid / totalNet) * CIRC;
            gapOffset += dash;
            const angle = (gapOffset / CIRC) * 2 * Math.PI - Math.PI / 2;
            const x1 = (CX + (R - SW / 2) * Math.cos(angle)).toFixed(1);
            const y1 = (CY + (R - SW / 2) * Math.sin(angle)).toFixed(1);
            const x2 = (CX + (R + SW / 2) * Math.cos(angle)).toFixed(1);
            const y2 = (CY + (R + SW / 2) * Math.sin(angle)).toFixed(1);
            donutSegments += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${GAP}" stroke-linecap="round"/>`;
        });
    }

    // Bare orizontale
    const maxVal = Math.max(...top5.map(g => Math.max(g.totalExp, g.totalPaid)), 1);
    const barRows = top5.map((g, i) => {
        const shade = peachShades[i % peachShades.length];
        const expW = Math.min((g.totalExp / maxVal) * 100, 100).toFixed(1);
        const paidW = Math.min((g.totalPaid / maxVal) * 100, 100).toFixed(1);
        return `<div class="mi-bar-duo-group">
            <div class="mi-bar-duo-label" style="color:var(--peach-text);">${g.name}</div>
            <div class="mi-bar-duo-bars">
                <div class="mi-bar-duo-row"><div class="mi-bar-duo" style="width:${expW}%;background:var(--bar-expected);"></div></div>
                <div class="mi-bar-duo-row"><div class="mi-bar-duo" style="width:${paidW}%;background:${shade};"></div></div>
            </div>
        </div>`;
    }).join("");

    // Tabel
    const tableRows = top5.length === 0
        ? `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:16px;">No paid outflows this year</td></tr>`
        : top5.map((g, i) => {
        const shade = peachShades[i % peachShades.length];
        return `<tr>
            <td><div class="mi-td-name" style="color:var(--peach-text);">${g.name}</div></td>
            <td class="mi-td-exp">${formatMoney(g.totalExp)}</td>
            <td style="color:var(--peach-text);">${formatMoney(g.totalPaid)}</td>
        </tr>`;
    }).join("");

    return `
        <div class="mi-cat-card">
            <div class="mi-cat-header" style="background:var(--peach);">
                <div class="mi-cat-header-name">TOP 5 OUTFLOWS IN ${year}</div>
            </div>
            <div class="mi-donut-section">
                <svg viewBox="0 0 180 180" role="img" class="mi-donut-svg" aria-label="Top 5 outflows ${year}">
                    ${donutSegments}
                    <text x="${CX}" y="${CY - 6}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--peach-text)">${year}</text>
                    <text x="${CX}" y="${CY + 10}" text-anchor="middle" font-size="11" fill="#999">TOP 5</text>
                </svg>
                <div class="mi-donut-legend">${legendItems || '<span style="font-size:11px;color:var(--muted);">No paid outflows this year</span>'}</div>
            </div>
            <div class="mi-table-scroll mi-table-summary" style="background:var(--peach-soft-3);">
                <table class="mi-cat-table">
                    <thead style="background:var(--peach-soft-2);"><tr><th>Name</th><th>Expected</th><th>Paid</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <table class="mi-cat-table mi-cat-total">
                <tfoot style="background:var(--peach-soft-2);">
                    <tr>
                        <td class="mi-cat-total-label">Total</td>
                        <td class="mi-cat-total-exp">${formatMoney(grandExp)}</td>
                        <td class="mi-cat-total-paid" style="color:var(--peach-text);">${formatMoney(grandPaid)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

function renderYearlyMonthlyCard(cat, color, yearBills, year) {
    const catBills = yearBills.filter(b => b.category === cat);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const monthData = monthNames.map((name, i) => {
        const mBills = catBills.filter(b => parseLocalDate(b.dueDate).getMonth() === i);
        const exp = mBills.filter(b => b.type !== "refund").reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
        const paid = mBills.filter(b => b.paid).reduce((s, b) => b.type === "refund" ? s - (parseFloat(getBillDisplayAmount(b)) || 0) : s + (parseFloat(getBillDisplayAmount(b)) || 0), 0);
        return { name, exp, paid };
    });

    const totalExp = monthData.reduce((s, m) => s + m.exp, 0);
    const totalPaid = monthData.reduce((s, m) => s + m.paid, 0);

    // SVG bar chart
    const W = 300, H = 130, PL = 36, PR = 6, PT = 8, PB = 16;
    const chartW = W - PL - PR;
    const chartH = H - PT - PB;
    const maxVal = Math.max(...monthData.map(m => Math.max(m.exp, m.paid)), 1);
    const barGroupW = chartW / 12;
    const barW = Math.floor(barGroupW * 0.35);

    // Y axis ticks
    const tickCount = 4;
    const tickStep = maxVal / tickCount;
    let yTicks = "";
    for (let t = 0; t <= tickCount; t++) {
        const val = tickStep * t;
        const y = PT + chartH - (val / maxVal) * chartH;
        const label = val >= 1000 ? "$" + (val / 1000).toFixed(1) + "k" : "$" + Math.round(val);
        yTicks += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
        yTicks += `<text x="${PL - 3}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--muted)">${label}</text>`;
    }

    // Bars + x labels
    let bars = "";
    monthData.forEach((m, i) => {
        const x = PL + i * barGroupW + barGroupW / 2;
        const expH = (m.exp / maxVal) * chartH;
        const paidH = (m.paid / maxVal) * chartH;
        const expY = PT + chartH - expH;
        const paidY = PT + chartH - paidH;

        // Expected bar (gri)
        if (m.exp > 0) {
            bars += `<rect x="${(x - barW - 1).toFixed(1)}" y="${expY.toFixed(1)}" width="${barW}" height="${expH.toFixed(1)}" fill="#ddd" rx="2"/>`;
        }
        // Paid bar (culoarea categoriei)
        if (m.paid > 0) {
            bars += `<rect x="${(x + 1).toFixed(1)}" y="${paidY.toFixed(1)}" width="${barW}" height="${paidH.toFixed(1)}" fill="${color.main}" rx="2"/>`;
        }
        // X label
        bars += `<text x="${x.toFixed(1)}" y="${(PT + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--muted)">${monthsShort[i]}</text>`;
    });

    // Baseline
    const baseY = (PT + chartH).toFixed(1);
    const svgChart = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" aria-label="${cat} monthly trends ${year}">
            ${yTicks}
            <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${baseY}" stroke="var(--line)" stroke-width="1"/>
            <line x1="${PL}" y1="${baseY}" x2="${W - PR}" y2="${baseY}" stroke="var(--line)" stroke-width="1"/>
            ${bars}
        </svg>`;

    const tableRows = monthData.map(m => `
        <tr>
            <td style="color:${color.text};">${m.name}</td>
            <td class="mi-td-exp">${m.exp > 0 ? formatMoney(m.exp) : '<span style="color:var(--line);">—</span>'}</td>
            <td style="color:${m.paid > 0 ? color.text : 'var(--line)'}; font-weight:${m.paid > 0 ? '700' : '400'};">${m.paid > 0 ? formatMoney(m.paid) : '—'}</td>
        </tr>`).join("");

    return `
        <div class="mi-cat-card">
            <div class="mi-cat-header" style="background:${color.main};">
                <div class="mi-cat-header-name">${cat.toUpperCase()} OVERVIEW</div>
            </div>
            <div class="mi-bar-chart-section">
                <div class="mi-bar-chart-title">Monthly ${cat} trends in ${year}</div>
                ${svgChart}
            </div>
            <div class="mi-table-scroll" style="background:${color.tableBg};">
                <table class="mi-cat-table">
                    <thead style="background:${color.soft};"><tr><th>Month</th><th>Expected</th><th>Paid</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <table class="mi-cat-table mi-cat-total">
                <tfoot style="background:${color.soft};">
                    <tr>
                        <td class="mi-cat-total-label">Total</td>
                        <td class="mi-cat-total-exp">${formatMoney(totalExp)}</td>
                        <td class="mi-cat-total-paid" style="color:${color.text};">${formatMoney(totalPaid)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

function renderYearlyCategoryCard(cat, color, yearBills, year) {
    const catBills = yearBills.filter(b => b.category === cat);
    const payments = catBills.filter(b => b.type !== "refund");
    const refunds = catBills.filter(b => b.type === "refund");

    // Grupăm refundurile după nume
    const refundMap = {};
    refunds.forEach(r => {
        const key = r.name.trim().toLowerCase();
        if (!refundMap[key]) refundMap[key] = 0;
        if (r.paid) refundMap[key] += parseFloat(getBillDisplayAmount(r)) || 0;
    });

    // Grupăm payments după nume
    const groups = {};
    payments.forEach(bill => {
        const key = bill.name.trim().toLowerCase();
        if (!groups[key]) {
            groups[key] = {
                name: bill.name,
                totalExp: 0,
                totalPaid: 0,
                count: 0,
                allPaid: true,
                anyOverdue: false
            };
        }
        const exp = parseFloat(bill.amount) || 0;
        const display = parseFloat(getBillDisplayAmount(bill)) || 0;
        groups[key].totalExp += exp;
        if (bill.paid) groups[key].totalPaid += display;
        groups[key].count++;
        if (!bill.paid) groups[key].allPaid = false;
        if (getBillStatus(bill) === "overdue") groups[key].anyOverdue = true;
    });

    // Scădem refundurile din grupuri
    Object.keys(groups).forEach(key => {
        if (refundMap[key]) {
            groups[key].totalPaid = Math.max(0, groups[key].totalPaid - refundMap[key]);
        }
    });

    const groupList = Object.values(groups).sort((a, b) => b.totalExp - a.totalExp);

    // Refund-uri standalone (fără payment cu același nume)
    const standaloneRefunds = refunds.filter(r => {
        const key = r.name.trim().toLowerCase();
        return !groups[key] && r.paid;
    });
    const standaloneRefundTotal = standaloneRefunds.reduce((s, r) => s + (parseFloat(getBillDisplayAmount(r)) || 0), 0);

    const totalExp = groupList.reduce((s, g) => s + g.totalExp, 0);
    const totalPaid = groupList.reduce((s, g) => s + g.totalPaid, 0) - standaloneRefundTotal;
    const totalLeftToPay = groupList.reduce((s, g) => s + (g.allPaid ? 0 : g.totalExp - g.totalPaid), 0);
    const totalFinal = totalExp;

    const R = 66, CX = 90, CY = 90, SW = 30, CIRC = 2 * Math.PI * R;
    const GAP = 1.5;
    let donutSegments = "", legendItems = "", offset = 0;

    const greyShades = ["#b0b0b0", "#c0c0c0", "#d0d0d0", "#dedede", "#ebebeb", "#f5f5f5"];
    const overdueShades = ["#ff8888", "#ff9999", "#ffaaaa", "#ffbbbb", "#ffcccc", "#ffdede"];

    // Donut arată doar paid amounts
    const paidGroups = groupList.filter(g => g.totalPaid > 0).sort((a, b) => b.totalPaid - a.totalPaid);

    if (paidGroups.length === 0) {
        donutSegments = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e0e0e0" stroke-width="${SW}"/>`;
    } else {
        const MAX_SLICES = 6;
        const topGroups = paidGroups.slice(0, MAX_SLICES);
        const othersGroups = paidGroups.slice(MAX_SLICES);
        const othersNet = othersGroups.reduce((s, g) => s + g.totalPaid, 0);
        if (othersNet > 0) topGroups.push({ name: null, totalPaid: othersNet, isOthers: true, count: othersGroups.length });

        const totalNet = topGroups.reduce((s, g) => s + g.totalPaid, 0);

        if (totalNet <= 0) {
            donutSegments = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e0e0e0" stroke-width="${SW}"/>`;
        } else {
            let paidIndex = 0;
            topGroups.forEach(g => {
                const shade = color.shades[paidIndex % color.shades.length];
                paidIndex++;

                const pct = g.totalPaid / totalNet;
                const dash = pct * CIRC;
                const billPct = Math.round(pct * 100);
                donutSegments += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${shade}" stroke-width="${SW}" stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 ${CX} ${CY})" stroke-linecap="butt"/>`;
                if (billPct >= 6) {
                    const midAngle = ((offset + dash / 2) / CIRC) * 2 * Math.PI - Math.PI / 2;
                    const lx = (CX + R * Math.cos(midAngle)).toFixed(1);
                    const ly = (CY + R * Math.sin(midAngle)).toFixed(1);
                    donutSegments += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="600" fill="#666">${billPct}%</text>`;
                }
                legendItems += `<div class="mi-dl-item"><div class="mi-dl-dot" style="background:${shade};"></div><span class="mi-dl-name">${g.isOthers ? `Others (${g.count})` : g.name}</span></div>`;
                offset += dash;
            });

            if (topGroups.length > 1) {
                let gapOffset = 0;
                topGroups.forEach(g => {
                    const dash = (g.totalPaid / totalNet) * CIRC;
                    gapOffset += dash;
                    const angle = (gapOffset / CIRC) * 2 * Math.PI - Math.PI / 2;
                    const x1 = (CX + (R - SW / 2) * Math.cos(angle)).toFixed(1);
                    const y1 = (CY + (R - SW / 2) * Math.sin(angle)).toFixed(1);
                    const x2 = (CX + (R + SW / 2) * Math.cos(angle)).toFixed(1);
                    const y2 = (CY + (R + SW / 2) * Math.sin(angle)).toFixed(1);
                    donutSegments += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="white" stroke-width="${GAP}" stroke-linecap="round"/>`;
                });
            }
        }
    }

    const pill2Class = groupList.length === 0 ? "mi-pill-neutral" : totalLeftToPay <= 0 ? "mi-pill-green" : "mi-pill-yellow";
    const pill2Val = groupList.length === 0 ? `No ${cat} this year` : totalLeftToPay <= 0 ? "All paid ✓" : `${formatMoney(totalLeftToPay)} left to pay`;

    const standaloneRefundRows = standaloneRefunds.map(r => {
        const amt = parseFloat(getBillDisplayAmount(r)) || 0;
        return `<tr>
            <td><div class="mi-td-name" style="color:${color.text};">${r.name}</div></td>
            <td class="mi-td-exp">—</td>
            <td style="color:var(--priority-4-color);">&#x27A1; ${formatMoney(amt)}</td>
        </tr>`;
    }).join("");

    const tableRows = groupList.length > 0 || standaloneRefunds.length > 0
        ? groupList.map(g => `
            <tr>
                <td><div class="mi-td-name" style="color:${color.text};">${g.name}${g.count > 1 ? ` <span style="font-size:11px;color:var(--muted);">×${g.count}</span>` : ""}</div></td>
                <td class="mi-td-exp">${formatMoney(g.totalExp)}</td>
                <td style="color:${g.totalPaid > 0 ? color.text : "var(--line)"};">${g.totalPaid > 0 ? formatMoney(g.totalPaid) : "—"}</td>
            </tr>`).join("") + standaloneRefundRows
        : `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:16px;">No ${cat} this year</td></tr>`;

    return `
        <div class="mi-cat-card">
            <div class="mi-cat-header" style="background:${color.main};">
                <div class="mi-cat-header-name">${cat}</div>
            </div>
            <div class="mi-donut-section">
                <svg viewBox="0 0 180 180" role="img" class="mi-donut-svg" aria-label="${cat} breakdown">
                    ${donutSegments}
                    <text x="${CX}" y="${CY - 6}" text-anchor="middle" font-size="15" font-weight="700" fill="${color.inputColor}">${year}</text>
                    <text x="${CX}" y="${CY + 10}" text-anchor="middle" font-size="11" fill="#999">${cat.split(" ")[0].toUpperCase()}</text>
                </svg>
                <div class="mi-donut-legend">${legendItems || `<span style="font-size:11px;color:var(--muted);">No ${cat} this year</span>`}</div>
            </div>
            <div class="mi-table-scroll" style="background:${color.tableBg};">
                <table class="mi-cat-table">
                    <thead style="background:${color.soft};"><tr><th>Name</th><th>Expected</th><th>Paid</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <table class="mi-cat-table mi-cat-total">
                <tfoot style="background:${color.soft};">
                    <tr>
                        <td class="mi-cat-total-label">Total</td>
                        <td class="mi-cat-total-exp">${formatMoney(totalExp)}</td>
                        <td class="mi-cat-total-paid" style="color:${color.text};">${formatMoney(totalPaid)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

function getBillDisplayAmount(bill) {
    return bill.actualAmount != null ? bill.actualAmount : bill.amount;
}

function getBillDebtPrincipal(bill) {
    return bill.actualDebtPrincipal != null ? bill.actualDebtPrincipal : bill.debtPrincipal;
}

function getBillDebtInterest(bill) {
    return bill.actualDebtInterest != null ? bill.actualDebtInterest : bill.debtInterest;
}

function applyBillFilters(bills, { statusFilter, priorityFilter, categoryFilter, monthFilter, yearFilter, dateString }) {
    return bills.filter(bill => {
        if (dateString !== undefined && getBillDisplayDate(bill) !== dateString) return false;
        const status = getBillStatus(bill);
        if (statusFilter === "paid" && !bill.paid) return false;
        if (statusFilter === "unpaid" && bill.paid) return false;
        if (statusFilter === "overdue" && status !== "overdue") return false;
        if (priorityFilter !== "" && String(bill.priority) !== priorityFilter) return false;
        if (categoryFilter !== "" && bill.category !== categoryFilter) return false;
        if (monthFilter !== "" || yearFilter !== "") {
            const d = parseLocalDate(getBillDisplayDate(bill));
            if (monthFilter !== "" && String(d.getMonth() + 1) !== monthFilter) return false;
            if (yearFilter !== "" && String(d.getFullYear()) !== yearFilter) return false;
        }
        return true;
    });
}

function sortBills(arr) {
    return arr.sort((a, b) => {
        if (a.paid !== b.paid) return a.paid ? 1 : -1;
        const statusA = getBillStatus(a);
        const statusB = getBillStatus(b);
        if (statusA === "overdue" && statusB !== "overdue") return -1;
        if (statusA !== "overdue" && statusB === "overdue") return 1;
        const dateA = getBillDisplayDate(a);
        const dateB = getBillDisplayDate(b);
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const isIncomeReceivedA = isIncomeCategory(a.category) && a.type === "payment";
        const isIncomeReceivedB = isIncomeCategory(b.category) && b.type === "payment";
        if (isIncomeReceivedA && !isIncomeReceivedB) return -1;
        if (!isIncomeReceivedA && isIncomeReceivedB) return 1;
        return (Number(a.priority) || 2) - (Number(b.priority) || 2);
    });
}

function sortBillsChronological(arr) {
    return arr.sort((a, b) => {
        const dateA = getBillDisplayDate(a);
        const dateB = getBillDisplayDate(b);
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const isIncomeReceivedA = isIncomeCategory(a.category) && a.type === "payment";
        const isIncomeReceivedB = isIncomeCategory(b.category) && b.type === "payment";
        if (isIncomeReceivedA && !isIncomeReceivedB) return -1;
        if (!isIncomeReceivedA && isIncomeReceivedB) return 1;
        const priA = isIncomeReceivedA ? -1 : (Number(a.priority) !== 0 ? Number(a.priority) : 99);
        const priB = isIncomeReceivedB ? -1 : (Number(b.priority) !== 0 ? Number(b.priority) : 99);
        return priA - priB;
    });
}

function initCalendarDragDrop() {
    const grid = els.calendarGrid;
    if (!grid) return;

    let draggedBillId = null;

    grid.querySelectorAll(".cal-bill").forEach(btn => {
        btn.setAttribute("draggable", "true");

        btn.addEventListener("dragstart", e => {
            draggedBillId = btn.dataset.billId;
            btn.classList.add("cal-bill-dragging");
            e.dataTransfer.effectAllowed = "move";
        });

        btn.addEventListener("dragend", () => {
            btn.classList.remove("cal-bill-dragging");
            grid.querySelectorAll(".day.drag-over").forEach(d => d.classList.remove("drag-over"));
        });

        let touchClone = null;

        btn.addEventListener("touchstart", e => {
            draggedBillId = btn.dataset.billId;
            btn.classList.add("cal-bill-dragging");
            const touch = e.touches[0];
            touchClone = btn.cloneNode(true);
            touchClone.style.cssText = `
                position: fixed;
                z-index: 9999;
                pointer-events: none;
                opacity: 0.85;
                width: ${btn.offsetWidth}px;
                left: ${touch.clientX - btn.offsetWidth / 2}px;
                top: ${touch.clientY - btn.offsetHeight / 2}px;
                transform: scale(1.05);
                box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            `;
            document.body.appendChild(touchClone);
        }, { passive: true });

        btn.addEventListener("touchmove", e => {
            if (!draggedBillId) return;
            e.preventDefault();
            const touch = e.touches[0];
            if (touchClone) {
                touchClone.style.left = `${touch.clientX - touchClone.offsetWidth / 2}px`;
                touchClone.style.top = `${touch.clientY - touchClone.offsetHeight / 2}px`;
            }
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const cell = target?.closest(".day[data-date]");
            grid.querySelectorAll(".day.drag-over").forEach(d => d.classList.remove("drag-over"));
            if (cell) cell.classList.add("drag-over");
        }, { passive: false });

        btn.addEventListener("touchend", e => {
            btn.classList.remove("cal-bill-dragging");
            grid.querySelectorAll(".day.drag-over").forEach(d => d.classList.remove("drag-over"));
            if (touchClone) { touchClone.remove(); touchClone = null; }
            if (!draggedBillId) return;
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const cell = target?.closest(".day[data-date]");
            if (!cell) { draggedBillId = null; return; }
            const dateString = cell.dataset.date;
            const bill = data.bills.find(b => b.id === draggedBillId);
            draggedBillId = null;
            if (!bill) return;
            bill.actualDate = dateString;
            selectedCalDay = dateString;
            saveData();
            renderAllPreservingCalPanel();
        });
    });

    grid.querySelectorAll(".day").forEach(cell => {
        const dateString = cell.dataset.date
            || (cell.getAttribute("onclick") || "").match(/'([^']+)'/)?.[1]
            || (cell.getAttribute("ondblclick") || "").match(/'([^']+)'/)?.[1];
        if (!dateString) return;

        cell.addEventListener("dragover", e => {
            if (!draggedBillId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            grid.querySelectorAll(".day.drag-over").forEach(d => d.classList.remove("drag-over"));
            cell.classList.add("drag-over");
        });

        cell.addEventListener("dragleave", e => {
            if (!cell.contains(e.relatedTarget)) cell.classList.remove("drag-over");
        });

        cell.addEventListener("drop", e => {
            e.preventDefault();
            cell.classList.remove("drag-over");
            if (!draggedBillId) return;

            const bill = data.bills.find(b => b.id === draggedBillId);
            draggedBillId = null;
            if (!bill) return;

            bill.actualDate = dateString;
            selectedCalDay = dateString;
            saveData();
            renderAllPreservingCalPanel();
        });

        // Long press pe mobile/tabletă → deschide Add Bill cu data zilei
        let longPressTimer = null;
        let longPressFired = false;
        cell.addEventListener("touchstart", e => {
            if (draggedBillId) return;
            longPressFired = false;
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                longPressFired = true;
                openAddBillWithDate(dateString);
            }, 500);
        }, { passive: false });
        cell.addEventListener("touchend", e => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            if (longPressFired) {
                e.preventDefault();
                e.stopImmediatePropagation();
                longPressFired = false;
            }
        });
        cell.addEventListener("touchmove", () => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        });
        cell.addEventListener("contextmenu", e => e.preventDefault());

        // Double click pe desktop
        cell.addEventListener("dblclick", () => {
            openAddBillWithDate(dateString);
        });
    });
}

function getBillDisplayDate(bill) {
    return bill.actualDate || bill.dueDate;
}

function getBillDateTooltip(bill) {
    if (bill.actualDate && bill.actualDate !== bill.dueDate) {
        const dateLabel = bill.paid ? "Paid date" : "New date";

        return `${dateLabel}: ${formatDisplayDate(parseLocalDate(bill.actualDate))}<br>Original due date: ${formatDisplayDate(parseLocalDate(bill.dueDate))}`;
    }

    return `Due date: ${formatDisplayDate(parseLocalDate(bill.dueDate))}`;
}

function getBillStatus(bill) {
    if (bill.paid) return "paid";

    const today = stripTime(new Date());
    const due = stripTime(parseLocalDate(getBillDisplayDate(bill)));

    if (due < today) return "overdue";
    return "upcoming";
}

function getDaysLabel(bill) {
    if (bill.paid) return `<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="var(--priority-4-color)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="3,10 8,15 17,5"/></svg> ${getPaidLabel(bill)}`;

    const today = stripTime(new Date());
    const due = stripTime(parseLocalDate(getBillDisplayDate(bill)));
    const diff = Math.round((due - today) / 86400000);

    if (diff < 0) return `<svg width="15" height="15" viewBox="0 0 20 20" fill="var(--yellow)" stroke="var(--red)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M10 3 L18 17 H2 Z" fill="var(--yellow)"/><line x1="10" y1="9" x2="10" y2="13"/><circle cx="10" cy="16" r="0.5" fill="var(--red)" stroke="none"/></svg> ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} overdue`;
    if (diff === 0) return `<svg width="15" height="15" viewBox="0 0 20 20" fill="var(--yellow)" stroke="var(--red)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M10 3 L18 17 H2 Z" fill="var(--yellow)"/><line x1="10" y1="9" x2="10" y2="13"/><circle cx="10" cy="16" r="0.5" fill="var(--red)" stroke="none"/></svg> Due today`;
    return `${diff} day${diff === 1 ? "" : "s"} left`;
}

function updateCurrencyInputDisplay() {
    const symbol = String(data.settings.currencySymbol || "").split("|")[0];
    const isAfter = data.settings.currencyPosition === "after";

    ["billAmountCurrency", "billPaidAmountCurrency", "billInterestCurrency", "billPaidInterestCurrency", "debtCCMinPaymentCurrency", "debtCCPlannedPaymentCurrency", "debtCCLimitCurrency", "debtLoanBalanceCurrency", "debtOtherBalanceCurrency", "debtOtherMonthlyPaymentCurrency", "accountCreditLimitCurrency", "savingsMonthlyContributionCurrency"].forEach(id => {
        const span = document.getElementById(id);
        if (!span) return;
        span.textContent = symbol;
        const wrap = span.closest(".amount-input-wrap");
        if (!wrap) return;
        if (isAfter) {
            wrap.classList.add("currency-after");
        } else {
            wrap.classList.remove("currency-after");
        }
    });
}

function formatMoney(amount) {
    const num = Number(amount || 0);
    const sign = num < 0 ? "-" : "";
    const value = Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currencySymbol = String(data.settings.currencySymbol || "").split("|")[0];

    return data.settings.currencyPosition === "before"
        ? `${sign}${currencySymbol}${value}`
        : `${sign}${value} ${currencySymbol}`;
}

function formatDisplayDate(date) {
    const today = new Date();
    const showYear = date.getFullYear() !== today.getFullYear();
    return date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        ...(showYear && { year: "numeric" })
    });
}

function parseLocalDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function toLocalDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sum(bills) {
    return bills.reduce((total, bill) => {
        const amount = Number(getBillDisplayAmount(bill) || 0);
        return bill.type === "refund" ? total - amount : total + amount;
    }, 0);
}

const BACKUP_DB_NAME = "ultimatePaycheckBackupDB";
const BACKUP_DB_VERSION = 1;
const BACKUP_STORE_NAME = "backupSettings";
const BACKUP_FILE_HANDLE_KEY = "backupFileHandle";

function openBackupDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
                db.createObjectStore(BACKUP_STORE_NAME);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function storeBackupFileHandle(handle) {
    const db = await openBackupDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BACKUP_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BACKUP_STORE_NAME);

        store.put(handle, BACKUP_FILE_HANDLE_KEY);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function getBackupFileHandle() {
    const db = await openBackupDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BACKUP_STORE_NAME, "readonly");
        const store = transaction.objectStore(BACKUP_STORE_NAME);
        const request = store.get(BACKUP_FILE_HANDLE_KEY);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function clearBackupFileHandle() {
    const db = await openBackupDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BACKUP_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BACKUP_STORE_NAME);

        store.delete(BACKUP_FILE_HANDLE_KEY);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

const BACKUP_DIRECTORY_HANDLE_KEY = "backupDirectoryHandle";

async function storeBackupDirectoryHandle(handle) {
    const db = await openBackupDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BACKUP_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BACKUP_STORE_NAME);

        store.put(handle, BACKUP_DIRECTORY_HANDLE_KEY);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function getBackupDirectoryHandle() {
    const db = await openBackupDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BACKUP_STORE_NAME, "readonly");
        const store = transaction.objectStore(BACKUP_STORE_NAME);
        const request = store.get(BACKUP_DIRECTORY_HANDLE_KEY);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function clearBackupDirectoryHandle() {
    const db = await openBackupDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BACKUP_STORE_NAME, "readwrite");
        const store = transaction.objectStore(BACKUP_STORE_NAME);

        store.delete(BACKUP_DIRECTORY_HANDLE_KEY);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

async function showWelcomeBackupReminder() {

    const hasOpenedBefore = localStorage.getItem("ultimatePaycheckHasOpenedBefore");
    const shownThisSession = sessionStorage.getItem("welcomeBackupShownThisSession");

    if (!hasOpenedBefore) {
        localStorage.setItem("ultimatePaycheckHasOpenedBefore", "true");
        return;
    }

    if (shownThisSession) return;

    const directoryHandle = await getBackupDirectoryHandle();

    sessionStorage.setItem("welcomeBackupShownThisSession", "true");

    setTimeout(() => {
        document.getElementById("welcomeBackupModal").classList.add("active");
    }, 500);
}

async function removeBackupLocation() {
    try {
        await clearBackupFileHandle();
        await clearBackupDirectoryHandle();

        const backupFileNameEl = document.getElementById("backupFileName");

        if (backupFileNameEl) {
            backupFileNameEl.textContent = "No backup folder selected. Choose a backup location.";
            backupFileNameEl.classList.remove("has-file");
        }

        alert("Backup location removed.");
    } catch (error) {
        console.error("Could not remove backup location:", error);
        alert("Could not remove backup location. Please try again.");
    }
}

async function updateBackupFolderDisplay() {
    const backupFileNameEl = document.getElementById("backupFileName");
    if (!backupFileNameEl) return;

    try {
        const directoryHandle = await getBackupDirectoryHandle();

        if (directoryHandle && directoryHandle.name) {
            backupFileNameEl.textContent =
                `Backup folder selected: ${directoryHandle.name}`;
            backupFileNameEl.classList.add("has-file");
        }
    } catch (error) {
        console.error("Could not load backup folder display:", error);
    }
}

async function chooseBackupDirectory() {
    if (!window.showDirectoryPicker) {
        alert("Your browser does not support folder selection.");
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker({
            id: "ultimate-paycheck-backup-folder",
            mode: "readwrite"
        });

        await storeBackupDirectoryHandle(directoryHandle);

        const backupFileNameEl = document.getElementById("backupFileName");

        if (backupFileNameEl) {
            backupFileNameEl.textContent =
                `Backup folder selected: ${directoryHandle.name}`;
            backupFileNameEl.classList.add("has-file");
            backupFileNameEl.classList.remove("warning");
        }

        alert("Backup folder selected successfully.");
    } catch (error) {
        if (error.name === "AbortError") return;

        console.error("Folder selection failed:", error);
    }
}

async function importLatestBackup() {
    const fileName = "ultimate-paycheck-v1-backup.json";
    const directoryHandle = await getBackupDirectoryHandle();

    if (!directoryHandle) {
        document.getElementById("importJson").click();
        return;
    }

    try {
        let permission = await directoryHandle.queryPermission({ mode: "read" });

        if (permission !== "granted") {
            permission = await directoryHandle.requestPermission({ mode: "read" });
        }

        if (permission !== "granted") {
            document.getElementById("importJson").click();
            return;
        }

        const fileHandle = await directoryHandle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const text = await file.text();
        const imported = JSON.parse(text);

        if (!imported || typeof imported !== "object") {
            alert("Invalid backup file.");
            return;
        }

        data = normalizeAppData(imported);

        saveData();

        loadBillNames();
        renderCategoryOptions();

        if (typeof renderCustomCurrencies === "function") {
            renderCustomCurrencies();
        }

        renderAll();

        alert("Latest backup imported successfully ✨");
    } catch (error) {
        console.error("Latest backup import failed:", error);
        document.getElementById("importJson").click();
    }
}

async function smartImportBackup() {
    if (!window.showDirectoryPicker) {
        document.getElementById("importJson").click();
        return;
    }

    const directoryHandle = await getBackupDirectoryHandle();

    if (directoryHandle) {
        await importLatestBackup();
    } else {
        document.getElementById("importJson").click();
    }
}

async function autoSaveToBackup() {
    try {
        const directoryHandle = await getBackupDirectoryHandle();
        if (!directoryHandle) return;

        let permission = await directoryHandle.queryPermission({ mode: "readwrite" });
        if (permission !== "granted") {
            permission = await directoryHandle.requestPermission({ mode: "readwrite" });
        }
        if (permission !== "granted") return;

        const fileName = "ultimate-paycheck-v1-backup.json";
        const activated = localStorage.getItem("ultimatePaycheckActivated");
        const exportData = activated ? { ...data, _activated: true } : data;
        const json = JSON.stringify(exportData);
        const blob = new Blob([json], { type: "application/json" });

        const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        backupDirty = false;
    } catch (error) {
        console.error("Auto backup failed:", error);
    }
}

async function exportJson() {
    const fileName = "ultimate-paycheck-v1-backup.json";
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });

    if (!window.showDirectoryPicker) {
        downloadBlob(blob, fileName);
        backupDirty = false;
        return;
    }

    try {
        let directoryHandle = await getBackupDirectoryHandle();

        if (!directoryHandle) {
            if (window.showSaveFilePicker) {
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: fileName,
                        types: [
                            {
                                description: "JSON Backup File",
                                accept: { "application/json": [".json"] }
                            }
                        ]
                    });

                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();

                    backupDirty = false;
                    alert("Backup saved successfully.");
                    return;
                } catch (error) {
                    if (error.name === "AbortError") return;
                    console.error("Manual backup save failed:", error);
                }
            }

            downloadBlob(blob, fileName);
            backupDirty = false;
            return;
        }

        let permission = await directoryHandle.queryPermission({ mode: "readwrite" });

        if (permission !== "granted") {
            permission = await directoryHandle.requestPermission({ mode: "readwrite" });
        }

        if (permission !== "granted") {
            downloadBlob(blob, fileName);
            backupDirty = false;
            return;
        }

        const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();

        await writable.write(blob);
        await writable.close();

        const backupFileNameEl = document.getElementById("backupFileName");

        if (backupFileNameEl) {
            backupFileNameEl.textContent = `Backup folder selected: ${directoryHandle.name}`;
            backupFileNameEl.classList.add("has-file");
            backupFileNameEl.classList.remove("warning");
        }

        backupDirty = false;
        alert("Backup saved successfully.");
    } catch (error) {
        if (error.name === "AbortError") return;

        console.error("Backup export failed:", error);
        downloadBlob(blob, fileName);
        backupDirty = false;
    }
}

window.addEventListener("beforeunload", (e) => {

    if (!backupDirty) return;

    setTimeout(() => {
        document.getElementById("backupReminderModal").classList.add("active");
    }, 300);

    e.preventDefault();
    e.returnValue = "";
});

function importJson(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
        try {
            const imported = JSON.parse(reader.result);

            if (!reader.result || reader.result.trim() === "") {
                alert("This backup file is empty. The export may not have completed. Please export again.");
                return;
            }

            if (!imported || typeof imported !== "object") {
                alert("Invalid backup file.");
                return;
            }

            if (imported._activated) {
                localStorage.setItem("ultimatePaycheckActivated", "true");
            }

            data = normalizeAppData(imported);

            saveData();

            loadBillNames();

            renderCategoryOptions();

            if (typeof renderCustomCurrencies === "function") {
                renderCustomCurrencies();
            }

            renderAll();

            alert("Backup imported successfully.");
        } catch (error) {
            alert("Could not import this file.");
        }
    };

    reader.readAsText(file);
    event.target.value = "";
}

async function exportCsv() {
    const headers = ["Name", "Category", "Type", "Priority", "Frequency", "Amount", "Actual Amount", "Due Date", "Actual Date", "Paid", "Credit Card", "From Account", "To Account", "Notes"];

    const rows = data.bills.map(bill => {
        const fromAcc = bill.fromAccount ? (data.accounts || []).find(a => a.id === bill.fromAccount) : null;
        const toAcc = bill.toAccount ? (data.accounts || []).find(a => a.id === bill.toAccount) : null;
        return [
            bill.name,
            bill.category,
            bill.type || "",
            data.priorityNames[Number(bill.priority)] || "",
            bill.frequency || "",
            bill.amount,
            bill.actualAmount != null ? bill.actualAmount : "",
            getBillDisplayDate(bill),
            bill.actualDate || "",
            bill.paid ? "Yes" : "No",
            isFromCreditAccount(bill) ? "Yes" : "No",
            fromAcc ? fromAcc.name : "",
            toAcc ? toAcc.name : "",
            bill.notes || ""
        ];
    });

    const csv = [headers, ...rows]
        .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))
        .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const fileName = "ultimate-paycheck-data.csv";

    if (window.showSaveFilePicker) {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [
                    {
                        description: "CSV File",
                        accept: { "text/csv": [".csv"] }
                    }
                ]
            });

            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (error) {
            if (error.name === "AbortError") return;
            console.error("CSV export failed:", error);
        }
    }

    downloadBlob(blob, fileName);
}

async function resetAppStorage() {
    data = structuredClone(defaultData);

    await clearBackupFileHandle();
    await clearBackupDirectoryHandle();

    const backupFileNameEl = document.getElementById("backupFileName");

    if (backupFileNameEl) {
        backupFileNameEl.textContent = "No backup folder selected. Choose a backup location.";
        backupFileNameEl.classList.remove("has-file");
    }
}

async function clearAllData() {
    if (!confirm("This will delete all transactions, accounts, debts, and saved transaction names from this browser. Category titles will stay. Continue?")) return;

    await resetAppStorage();

    saveData();
    loadBillNames();
    renderCategoryOptions();
    renderAll();

    alert("All data cleared.");
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showHelpIconTooltip(iconEl) {
    const tip = document.getElementById("helpIconTooltip");
    if (!tip) return;
    const rect = iconEl.getBoundingClientRect();
    const margin = 6;
    const tipRect = tip.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));

    let top = rect.top - tipRect.height - 8;
    if (top < margin) top = rect.bottom + 8;

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.classList.add("active");
}

function hideHelpIconTooltip() {
    const tip = document.getElementById("helpIconTooltip");
    if (tip) tip.classList.remove("active");
}

function truncOpt(text, max) {
    max = max || 15;
    var chars = Array.from(String(text));
    return chars.length > max ? chars.slice(0, max).join('') + '...' : text;
}

function saveBillNames(shouldSave = true) {
    const oldCategories = [...data.categories];
    const billNameGroups = [];

    document.querySelectorAll(".bill-names-column").forEach((column, index) => {
        const titleInput = column.querySelector(".bill-names-title-input");
        const title = titleInput ? titleInput.value.trim() : "";

        const names = [...column.querySelectorAll("input.bill-name-input")]
            .map(input => input.value.trim())
            .filter(Boolean);

        if (title) {
            billNameGroups.push({ title, names });

            const oldTitle = oldCategories[index];
            if (oldTitle && oldTitle !== title) {
                data.bills = data.bills.map(bill =>
                    bill.category === oldTitle
                        ? { ...bill, category: title }
                        : bill
                );
            }
        }
    });

    data.categories = billNameGroups.map(group => group.title);
    data.billNameGroups = billNameGroups;

    const priorityInputs = document.querySelectorAll(".priority-name-input");
    data.priorityNames = [...priorityInputs].map(input => input.value.trim() || "");

    if (shouldSave) {
        saveData();
    }
}

function createBillNameInput(value = "") {
    const row = document.createElement("div");
    row.className = "bill-name-row";
    row.setAttribute("draggable", "false");

    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.className = "bill-name-input";

    input.addEventListener("paste", (e) => {
        const pastedText = (e.clipboardData || window.clipboardData).getData("text");
        if (!pastedText.includes("\n")) return;
        e.preventDefault();
        const values = pastedText.split(/[\r\n\t]+/).map(v => v.trim()).filter(Boolean);
        if (!values.length) return;
        const list = row.closest(".bill-names-list");
        input.value = values[0];
        values.slice(1).forEach(value => {
            const newRow = createBillNameInput(value);
            list.appendChild(newRow);
        });
        saveBillNames(false);
    });

    input.addEventListener("blur", () => {
        if (!input.value.trim()) {
            row.remove();
        }
        row.setAttribute("draggable", "false");
        saveBillNames(false);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (!input.value.trim()) {
            row.remove();
            return;
        }
        const list = row.closest(".bill-names-list");
        const newRow = createBillNameInput("");
        list.insertBefore(newRow, row.nextSibling);
        newRow.querySelector(".bill-name-input").focus();
    });

    const handle = document.createElement("span");
    handle.className = "bill-name-handle";
    handle.innerHTML = `<svg width="10" height="14" viewBox="0 0 10 14" fill="none"><circle cx="3" cy="2.5" r="1.2" fill="#aaa"/><circle cx="7" cy="2.5" r="1.2" fill="#aaa"/><circle cx="3" cy="7" r="1.2" fill="#aaa"/><circle cx="7" cy="7" r="1.2" fill="#aaa"/><circle cx="3" cy="11.5" r="1.2" fill="#aaa"/><circle cx="7" cy="11.5" r="1.2" fill="#aaa"/></svg>`;

    handle.addEventListener("mousedown", () => {
        row.setAttribute("draggable", "true");
    });

    input.addEventListener("mousedown", () => {
        row.setAttribute("draggable", "false");
    });

    row.addEventListener("dragstart", (e) => {
        window._billNameDragSrc = row;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
        window._billNameDragSrc = null;
        row.classList.remove("dragging");
        row.closest(".bill-names-list")
            ?.querySelectorAll(".bill-name-row")
            .forEach(r => r.classList.remove("drag-over"));
        saveBillNames(true);
    });

    row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (window._billNameDragSrc && window._billNameDragSrc !== row) {
            row.classList.add("drag-over");
        }
    });

    row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
    });

    row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        if (!window._billNameDragSrc || window._billNameDragSrc === row) return;
        const list = row.closest(".bill-names-list");
        const srcList = window._billNameDragSrc.closest(".bill-names-list");
        if (list !== srcList) return;
        const rows = [...list.querySelectorAll(".bill-name-row")];
        const srcIdx = rows.indexOf(window._billNameDragSrc);
        const tgtIdx = rows.indexOf(row);
        if (srcIdx < tgtIdx) {
            list.insertBefore(window._billNameDragSrc, row.nextSibling);
        } else {
            list.insertBefore(window._billNameDragSrc, row);
        }
    });

    handle.addEventListener("touchstart", (e) => {
        e.preventDefault();
        window._billNameDragSrc = row;
        row.classList.add("dragging");
    }, { passive: false });

    handle.addEventListener("touchmove", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const target = el?.closest(".bill-name-row");
        row.closest(".bill-names-list")
            ?.querySelectorAll(".bill-name-row")
            .forEach(r => r.classList.remove("drag-over"));
        if (target && target !== row) {
            target.classList.add("drag-over");
        }
    }, { passive: false });

    handle.addEventListener("touchend", (e) => {
        e.preventDefault();
        row.classList.remove("dragging");
        const touch = e.changedTouches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const target = el?.closest(".bill-name-row");
        row.closest(".bill-names-list")
            ?.querySelectorAll(".bill-name-row")
            .forEach(r => r.classList.remove("drag-over"));
        if (target && target !== row) {
            const list = row.closest(".bill-names-list");
            const srcList = target.closest(".bill-names-list");
            if (list === srcList) {
                const rows = [...list.querySelectorAll(".bill-name-row")];
                const srcIdx = rows.indexOf(row);
                const tgtIdx = rows.indexOf(target);
                if (srcIdx < tgtIdx) {
                    list.insertBefore(row, target.nextSibling);
                } else {
                    list.insertBefore(row, target);
                }
                saveBillNames(true);
            }
        }
        window._billNameDragSrc = null;
    }, { passive: false });

    row.appendChild(handle);
    row.appendChild(input);
    return row;
}

function loadBillNames() {
    const saved = Array.isArray(data.billNameGroups) ? data.billNameGroups : [];

    document.querySelectorAll(".bill-names-column").forEach((column, index) => {
        const group = saved[index];
        const titleInput = column.querySelector(".bill-names-title-input");
        const list = column.querySelector(".bill-names-list");

        if (titleInput) {
            titleInput.value = group?.title || defaultData.categories[index] || "";
        }

        if (list) {
            list.innerHTML = "";

            (group?.names || []).forEach(name => {
                const input = createBillNameInput(name);
                list.appendChild(input);
            });
        }
    });

    const savedPriorities = Array.isArray(data.priorityNames) ? data.priorityNames : defaultData.priorityNames;

    document.querySelectorAll(".priority-name-input").forEach((input, index) => {
        input.value = savedPriorities[index] ?? defaultData.priorityNames[index];
    });
}

document.querySelectorAll(".bill-names-column .btn.soft").forEach(btn => {
    btn.addEventListener("click", () => {
        const column = btn.parentElement;
        const list = column.querySelector(".bill-names-list");
        const title = column.querySelector(".bill-names-title").textContent.toLowerCase();

        let cleanTitle = title.toLowerCase();

        if (cleanTitle.endsWith("s")) {
            cleanTitle = cleanTitle.slice(0, -1);
        }

        const input = createBillNameInput("");
        input.placeholder = `Type ${cleanTitle}...`;

        list.appendChild(input);
        const textInput = input.querySelector(".bill-name-input");
        if (textInput) textInput.focus();
        else input.focus();
    });
});

loadBillNames();
init();

let _calBillModalId = null;

function openCalBillModal(billId) {
    const bill = data.bills.find(b => b.id === billId);
    if (!bill) return;
    _calBillModalId = billId;

    const modal = document.getElementById("calBillModal");
    const content = document.getElementById("calBillModalContent");
    if (!modal || !content) return;

    const status = getBillStatus(bill);
    const catIndex = bill.category === "Transfers" ? 6 : bill.category === "Investments" ? 7 : Math.max(1, data.categories.indexOf(bill.category) + 1);
    const priIndex = Number(bill.priority) + 1;

    content.innerHTML = `
        <div class="bill-card cal-modal-card ${status} category-color-${catIndex} priority-border-${priIndex}" style="margin:0; position:relative;">
            <button class="modal-close-btn" onclick="closeCalBillModal()" style="position:absolute; top:8px; right:8px; z-index:1;">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/>
                </svg>
            </button>
            <div class="bill-info">
                <div class="bill-meta bill-main-line" style="justify-content:space-between; padding-right:28px;">
                <span class="bill-title-inline app-tooltip-trigger"><span class="bill-title-text">${escapeHtml(bill.name)}</span><span class="app-tooltip">${data.priorityNames[Number(bill.priority)] || "Priority"}</span></span>
                <span class="bill-amount-wrap">
    ${bill.actualAmount != null && Number(bill.amount) > 0 && Number(bill.actualAmount) !== Number(bill.amount)
            ? `<span class="bill-original-amount">${formatMoney(bill.amount)}</span>`
            : ""
        }

    <span class="bill-amount">
        ${bill.type === "refund" ? `<span class="bill-refund-icon ${(isIncomeCategory(bill.category) || isSavingsCategory(bill.category)) ? "refund-out" : "refund-in"} app-tooltip-trigger">&#x27A1;<span class="app-tooltip">${isIncomeCategory(bill.category) ? "Returned" : isSavingsCategory(bill.category) ? "Withdrawn" : "Received"}</span></span>` : ""}
        <span class="bill-frequency-icon">
            <span class="app-tooltip-trigger">
                ${bill.frequency === "one-time" ? "◷" : "↻"}
                <span class="app-tooltip">
                    ${bill.frequency === "one-time" ? "One-Time" : "Recurring"}
                </span>
            </span>
        </span>

        <span>${formatMoney(getBillDisplayAmount(bill))}</span>
    </span>
</span>
                </div>
                ${(bill.fromAccount || bill.toAccount) ? `<div class="bill-accounts-row">${bill.fromAccount ? `<span class="bill-account-tag">⬆️ ${escapeHtml((data.accounts||[]).find(a=>a.id===bill.fromAccount)?.name||'')}</span>` : ''}${bill.fromAccount && bill.toAccount ? ` → ` : ''}${bill.toAccount ? `<span class="bill-account-tag">⬇️ ${escapeHtml((data.accounts||[]).find(a=>a.id===bill.toAccount)?.name||'')}</span>` : ''}</div>` : ''}
                <div class="bill-details-row">
                    <div class="bill-date-wrap">
                    <span class="pill app-tooltip-trigger" style="display:inline-flex; align-items:center; gap:6px;"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; opacity:0.4;"><rect x="2" y="5" width="16" height="13" rx="2"/><line x1="2" y1="9" x2="18" y2="9"/><line x1="7" y1="3" x2="7" y2="7"/><line x1="13" y1="3" x2="13" y2="7"/>
                    </svg>${formatDisplayDate(parseLocalDate(getBillDisplayDate(bill)))}<span class="app-tooltip">${getBillDateTooltip(bill)}</span></span></div>
                    <div class="bill-status-wrap"><span class="bill-countdown">${getDaysLabel(bill)}</span></div>
                    ${bill.notes ? `<span class="bill-notes">${escapeHtml(bill.notes)}</span>` : ""}
                </div>
            </div>
            <div class="bill-actions">
                <button class="mini-btn ${bill.paid ? "unpaid-btn" : "paid-btn"}" onclick="calBillModalTogglePaid()">${bill.paid ? getUnpaidLabel(bill) : getPaidLabel(bill)}</button>
                <div class="bill-icon-btns">
                    <button class="mini-btn edit-btn" onclick="calBillModalEdit()"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5 L16.5 6.5 L7 16 L3 17 L4 13 Z"/><line x1="11" y1="5.5" x2="14.5" y2="9"/></svg></button>
                    <button class="mini-btn delete-btn" onclick="calBillModalDelete()"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 17,6"/><path d="M8 6 V4 Q8 3 9 3 H11 Q12 3 12 4 V6"/><path d="M5 6 L6 17 Q6 18 7 18 H13 Q14 18 14 17 L15 6"/><line x1="9" y1="10" x2="9" y2="15"/><line x1="11" y1="10" x2="11" y2="15"/></svg></button>
                </div>
            </div>
        </div>
    `;

    modal.classList.add("active");
}

function closeCalBillModal() {
    const modal = document.getElementById("calBillModal");
    if (modal) modal.classList.remove("active");
    _calBillModalId = null;
}

function calBillModalTogglePaid() {
    if (!_calBillModalId) return;

    const bill = data.bills.find(b => b.id === _calBillModalId);
    if (!bill) return;

    const dateString = getBillDisplayDate(bill);

    data.bills = data.bills.map(b =>
        b.id === _calBillModalId ? { ...b, paid: !b.paid } : b
    );

    selectedCalDay = dateString;

    saveData();
    renderAllPreservingCalPanel();

    closeCalBillModal();
}

function calBillModalEdit() {
    if (!_calBillModalId) return;
    const id = _calBillModalId;
    closeCalBillModal();
    editBill(id);
}

function calBillModalDelete() {
    if (!_calBillModalId) return;

    const bill = data.bills.find(b => b.id === _calBillModalId);
    if (!bill) return;

    const dateString = bill.dueDate;
    const panel = document.getElementById("calDayPanel");
    const wasExpanded = panel?.classList.contains("expanded");

    closeCalBillModal();

    if (bill.frequency === "one-time") {

        if (!confirm("Delete this transaction?")) return;

        data.bills = data.bills.filter(b => b.id !== bill.id);

        selectedCalDay = dateString;

        saveData();
        renderAll();

        if (wasExpanded) {
            requestAnimationFrame(() => {
                toggleCalDrawer(true);
            });
        }

        return;
    }

    window._deletingBillId = bill.id;

    const modal = document.getElementById("deleteRecurringModal");

    if (modal) {
        modal.classList.add("active");
    }

    if (wasExpanded) {
        requestAnimationFrame(() => {
            toggleCalDrawer(true);
        });
    }
}

window.openCalBillModal = openCalBillModal;
window.openAddBillWithDate = openAddBillWithDate;
window.closeCalBillModal = closeCalBillModal;
window.calBillModalTogglePaid = calBillModalTogglePaid;
window.calBillModalEdit = calBillModalEdit;
window.calBillModalDelete = calBillModalDelete;

window.togglePaid = togglePaid;
window.editBill = editBill;
window.deleteBill = deleteBill;
window.chooseBackupDirectory = chooseBackupDirectory;
window.removeBackupLocation = removeBackupLocation;

// ============================================================
// ACCOUNTS
// ============================================================

window._ACCOUNT_EMOJIS = {
    bank: "🏦",
    cash: "💵",
    savings: "🐷",
    investment: "📈",
    credit: "💳"
};

window._ACCOUNT_LABELS = {
    bank: "Bank",
    cash: "Cash",
    savings: "Savings",
    investment: "Investment",
    credit: "Credit card"
};

let editingAccountId = null;

function openAccountModal(id) {
    const resolvedId = (id !== undefined && id !== null && id !== "") ? id : null;
    editingAccountId = resolvedId;

    ["accountName", "accountType", "accountBalance", "accountStartDate"].forEach(elId => {
        const el = document.getElementById(elId);
        if (el) el.classList.remove("field-error");
    });

    const title = document.getElementById("accountModalTitle");
    const nameEl = document.getElementById("accountName");
    const typeEl = document.getElementById("accountType");
    const balEl = document.getElementById("accountBalance");
    const dateEl = document.getElementById("accountStartDate");

    if (resolvedId) {
        const acc = data.accounts.find(a => a.id === resolvedId);
        if (!acc) return;
        document.getElementById("accountModal")._editingId = resolvedId;
        const col = ACC_COL_TYPES.find(c => c.type === acc.type);
        title.textContent = col ? `${col.emoji} Edit ${col.label} Account` : "✏️ Edit Account";
        const deleteBtn = document.getElementById("accountDeleteBtn");
        if (deleteBtn) deleteBtn.style.display = "";
        const balIcon = document.querySelectorAll("#accountModal .help-icon")[2];
        if (balIcon && col) balIcon.setAttribute("data-help", col.help);
        const nameIcon = document.getElementById("accountNameHelpIcon");
        if (nameIcon && col) nameIcon.setAttribute("data-help", col.nameHelp);
        nameEl.value = acc.name;
        typeEl.value = acc.type;
        document.getElementById("accountTypeRow").style.display = "none";
        balEl.value = parseFloat(acc.startBalance).toFixed(2);
        balEl.classList.add("has-value");
        dateEl.value = acc.startDate;
        if (acc.startDate) {
            dateEl.classList.add("has-value");
        } else {
            dateEl.classList.remove("has-value");
        }
        const limitRow = document.getElementById("accountCreditLimitRow");
        const limitEl = document.getElementById("accountCreditLimit");
        if (acc.type === "credit" && limitRow && limitEl) {
            limitRow.style.display = "";
            if (acc.creditLimit) {
                limitEl.value = parseFloat(acc.creditLimit).toFixed(2);
                limitEl.classList.add("has-value");
            } else {
                limitEl.value = "";
                limitEl.classList.remove("has-value");
            }
        } else if (limitRow) {
            limitRow.style.display = "none";
        }
    } else {
        const deleteBtn = document.getElementById("accountDeleteBtn");
        if (deleteBtn) deleteBtn.style.display = "none";
        title.textContent = "🏦 Add account";
        nameEl.value = "";
        typeEl.innerHTML = `<option value="">Select type</option>
                <option value="cash">💵 Cash</option>
                <option value="bank">🏦 Bank</option>
                <option value="savings">🐷 Savings</option>
                <option value="credit">💳 Credit card</option>
                <option value="investment">📈 Investment</option>`;
        balEl.value = "";
        balEl.placeholder = "0.00";
        balEl.classList.remove("has-value");
        dateEl.classList.remove("has-value");
        dateEl.value = "";
        dateEl.type = "text";
        dateEl.type = "date";
        const tip = document.getElementById("balanceCreditTip");
        if (tip) tip.style.display = "none";
        const limitRow = document.getElementById("accountCreditLimitRow");
        if (limitRow) limitRow.style.display = "none";
        const limitEl = document.getElementById("accountCreditLimit");
        if (limitEl) { limitEl.value = ""; limitEl.classList.remove("has-value"); }
    }

    balEl.onfocus = function() {
        const type = typeEl.value || (resolvedId ? data.accounts.find(a => a.id === resolvedId)?.type : "");
        const tip = document.getElementById("balanceCreditTip");
        if (tip) tip.style.display = type === "credit" ? "" : "none";
    };

    typeEl.onchange = function() {
        const tip = document.getElementById("balanceCreditTip");
        if (tip) tip.style.display = "none";
        const limitRow = document.getElementById("accountCreditLimitRow");
        const limitEl = document.getElementById("accountCreditLimit");
        if (limitRow) limitRow.style.display = this.value === "credit" ? "" : "none";
        if (limitEl && this.value !== "credit") { limitEl.value = ""; limitEl.classList.remove("has-value"); }
    };

    balEl.onblur = function() {
        const tip = document.getElementById("balanceCreditTip");
        if (tip) tip.style.display = "none";
        if (this.value === "" || isNaN(parseFloat(this.value))) {
            this.value = "";
        } else {
            this.value = parseFloat(this.value).toFixed(2);
        }
    };

    document.getElementById("accountModal").classList.add("active");
    nameEl.focus();
}

function closeAccountModal() {
    const m = document.getElementById("accountModal");
    m.classList.remove("active");
    m.classList.remove("from-col");
    m.style.zIndex = "";
    document.getElementById("accountTypeRow").style.display = "";
    editingAccountId = null;
}

function saveAccount() {
    const name = document.getElementById("accountName").value.trim();
    const type = document.getElementById("accountType").value;
    const startBalance = parseFloat(document.getElementById("accountBalance").value) || 0;
    const startDate = document.getElementById("accountStartDate").value;

    const nameEl = document.getElementById("accountName");
    const typeEl = document.getElementById("accountType");
    const balEl2 = document.getElementById("accountBalance");
    const dateEl2 = document.getElementById("accountStartDate");
    const limitEl2 = document.getElementById("accountCreditLimit");
    [nameEl, typeEl, balEl2, dateEl2, limitEl2].forEach(el => el && el.classList.remove("field-error"));
    limitEl2?.closest(".amount-input-wrap")?.classList.remove("field-error");

    let hasError = false;
    if (!name) { nameEl.classList.add("field-error"); nameEl.focus(); hasError = true; }
    if (!type) { typeEl.classList.add("field-error"); if (!hasError) typeEl.focus(); hasError = true; }
    if (balEl2.value === "") { balEl2.classList.add("field-error"); if (!hasError) balEl2.focus(); hasError = true; }
    if (!dateEl2.value) { dateEl2.classList.add("field-error"); if (!hasError) dateEl2.focus(); hasError = true; }
    if (type === "credit" && (!limitEl2 || limitEl2.value === "" || parseFloat(limitEl2.value) <= 0)) {
        if (limitEl2) { limitEl2.closest(".amount-input-wrap")?.classList.add("field-error"); if (!hasError) limitEl2.focus(); }
        hasError = true;
    }
    if (hasError) return;

    const creditLimit = type === "credit" ? (parseFloat(document.getElementById("accountCreditLimit")?.value) || null) : null;

    if (editingAccountId) {
        const idx = data.accounts.findIndex(a => a.id === editingAccountId);
        if (idx !== -1) {
            const updated = { ...data.accounts[idx], name, type, startBalance, startDate };
            if (type === "credit") { updated.creditLimit = creditLimit; } else { delete updated.creditLimit; }
            data.accounts[idx] = updated;
        }
    } else {
        if (data.accounts.length >= 20) {
            alert("You can add up to 20 accounts.");
            return;
        }
        const newAccData = { id: crypto.randomUUID(), name, type, startBalance, startDate };
        if (type === "credit" && creditLimit) newAccData.creditLimit = creditLimit;
        const newId = newAccData.id;
        data.accounts.push(newAccData);
        if (type === "savings" && document.getElementById("savingsGoalModal")?.classList.contains("active")) {
            saveData();
            closeAccountModal();
            renderAccountsCols();
            populateSavingsGoalAccountDropdown(newId);
            return;
        }
        if (type === "credit" && document.getElementById("debtModal")?.classList.contains("active")) {
            saveData();
            closeAccountModal();
            renderAccountsCols();
            updateDebtTypeFields();
            document.getElementById("debtLinkedAccount").value = newId;
            syncCustomSelect("debtLinkedAccount");
            if (creditLimit) {
                const limitInput = document.getElementById("debtCCLimit");
                if (limitInput) { limitInput.value = parseFloat(creditLimit).toFixed(2); }
            }
            return;
        }
    }

    saveData();
    closeAccountModal();
    renderAccountsCols();
    if (typeof renderAccountsPage === "function") renderAccountsPage();
}

function deleteAccount(id) {
    const acc = data.accounts.find(a => a.id === id);
    if (!acc) return;

    const usedInBills = data.bills.some(b => b.fromAccount === id || b.toAccount === id);
    const warningMsg = usedInBills
        ? `"${acc.name}" is used in one or more transactions. Deleting it will remove it from those transactions.\n\nAre you sure?`
        : `Delete "${acc.name}"?`;

    if (!confirm(warningMsg)) return;

    data.accounts = data.accounts.filter(a => a.id !== id);

    if (usedInBills) {
        data.bills = data.bills.map(b => ({
            ...b,
            fromAccount: b.fromAccount === id ? null : b.fromAccount,
            toAccount: b.toAccount === id ? null : b.toAccount
        }));
    }

    saveData();
    renderAccountsCols();
}

function deleteAccountFromModal() {
    const id = editingAccountId;
    if (!id) return;
    const usedInBills = data.bills.some(b => b.fromAccount === id || b.toAccount === id);
    const msg = usedInBills
        ? "This account is used in existing transactions. Deleting it will remove the account link from those transactions. Continue?"
        : "Delete this account?";
    if (!confirm(msg)) return;
    if (usedInBills) data.bills = data.bills.map(b => ({
        ...b,
        fromAccount: b.fromAccount === id ? null : b.fromAccount,
        toAccount: b.toAccount === id ? null : b.toAccount
    }));
    data.accounts = data.accounts.filter(a => a.id !== id);
    saveData();
    closeAccountModal();
    renderAccountsCols();
}

window.deleteAccountFromModal = deleteAccountFromModal;
window.openAccountModal = openAccountModal;

function openDebtModal(id = null) {
    document.getElementById("debtName").value = "";
    document.getElementById("debtType").value = "";
    document.getElementById("debtLinkedAccountRow").style.display = "none";
    document.getElementById("debtDeleteBtn").style.display = "none";
    document.getElementById("debtArchiveBtn").style.display = "none";
    document.getElementById("debtModalTitle").textContent = "💳 Add Debt";
    document.getElementById("debtModal")._editingId = null;
    document.getElementById("debtApr").value = "";
    document.getElementById("debtCCLimit").value = "";
    document.getElementById("debtCCMinPayment").value = "";
    document.getElementById("debtCCPlannedPayment").value = "";
    document.getElementById("debtCCFirstPaymentDate").value = "";
    document.getElementById("debtCCFirstPaymentDate").classList.remove("has-value");
    document.getElementById("debtLoanBalance").value = "";
    document.getElementById("debtLoanRateType").value = "fixed";
    document.getElementById("debtLoanRepayType").value = "annuity";
    document.getElementById("debtLoanTerm").value = "";
    document.getElementById("debtLoanFirstPaymentDate").value = "";
    document.getElementById("debtLoanFirstPaymentDate").classList.remove("has-value");
    document.getElementById("debtNotes").value = "";
    document.getElementById("debtOtherBalance").value = "";
    document.getElementById("debtOtherRepayType").value = "";
    document.getElementById("debtOtherDueDate").value = "";
    document.getElementById("debtOtherDueDate").classList.remove("has-value");
    document.getElementById("debtOtherDueDateMode").value = "installments";
    document.getElementById("debtOtherDueDateFirstPaymentDate").value = "";
    document.getElementById("debtOtherDueDateFirstPaymentDate").classList.remove("has-value");
    document.getElementById("debtOtherFirstPaymentDate").value = "";
    document.getElementById("debtOtherFirstPaymentDate").classList.remove("has-value");
    document.getElementById("debtOtherMonthlyPayment").value = "";
    document.getElementById("debtCCFields").classList.remove("debt-type-fields--active");
    document.getElementById("debtLoanFields").classList.remove("debt-type-fields--active");
    document.getElementById("debtOtherFields").classList.remove("debt-type-fields--active");
    document.getElementById("debtOtherDueDateFields").classList.remove("debt-type-fields--active");
    document.getElementById("debtOtherDueDateFirstPaymentFields").classList.remove("debt-type-fields--active");
    document.getElementById("debtOtherMonthlyFields").classList.remove("debt-type-fields--active");
    document.getElementById("debtTxGenerate").checked = true;
    document.getElementById("debtTxFields").style.display = "";
    document.getElementById("debtTxCCNote").style.display = "none";
    document.getElementById("debtTxPriority").value = "";
    syncCustomSelect("debtTxPriority");
    document.getElementById("debtSaveBtn").textContent = "Save debt";
    document.getElementById("debtTxHint").style.display = "none";
    document.getElementById("debtDeletePlannedBtn").style.display = "none";
    populateDebtTxFromAccount();
    document.getElementById("debtLoanDisbursementAccount").innerHTML = getAccountOptions("Transfers", "payment", "to");
    document.getElementById("debtLoanDisbursementAccount").value = "";
    document.getElementById("debtLoanDisbursementAccount").closest("label").style.display = "";
    document.getElementById("debtLoanDisbursementHint").style.display = "none";

    if (id) {
        const debt = data.debts.find(d => d.id === id);
        if (!debt) return;
        document.getElementById("debtModalTitle").textContent = "✏️ Edit Debt";
        document.getElementById("debtName").value = debt.name;
        document.getElementById("debtType").value = debt.type;
        syncCustomSelect("debtType");
        document.getElementById("debtDeleteBtn").style.display = "";
        const archBtn = document.getElementById("debtArchiveBtn");
        const canArchive = debt.paidOff || debt.archived || (debt.type === "credit_card" && getDebtBalance(debt) <= 0.005);
        if (canArchive) {
            archBtn.style.display = "";
            archBtn.textContent = debt.archived ? "Unarchive" : "Archive";
        } else {
            archBtn.style.display = "none";
        }
        document.getElementById("debtModal")._editingId = id;
        updateDebtTypeFields();
        if (debt.linkedAccountId) {
            document.getElementById("debtLinkedAccount").value = debt.linkedAccountId;
            syncCustomSelect("debtLinkedAccount");
        }
        const fmt2 = v => (v != null && v !== "") ? parseFloat(v).toFixed(2) : "";
        document.getElementById("debtApr").value = fmt2(debt.apr);
        document.getElementById("debtNotes").value = debt.notes || "";
        if (debt.type === "credit_card") {
            const linkedAcc = (data.accounts || []).find(a => a.id === debt.linkedAccountId);
            const effectiveLimit = linkedAcc?.creditLimit ?? debt.creditLimit;
            document.getElementById("debtCCLimit").value = fmt2(effectiveLimit);
            document.getElementById("debtCCMinPayment").value = fmt2(debt.minPayment);
            document.getElementById("debtCCPlannedPayment").value = fmt2(debt.plannedPayment);
            document.getElementById("debtCCFirstPaymentDate").value = debt.firstPaymentDate || "";
            document.getElementById("debtCCFirstPaymentDate").classList.toggle("has-value", !!debt.firstPaymentDate);
        } else if (debt.type === "loan") {
            document.getElementById("debtLoanBalance").value = fmt2(debt.beginningBalance);
            document.getElementById("debtLoanRateType").value = debt.rateType || "fixed";
            syncCustomSelect("debtLoanRateType");
            document.getElementById("debtLoanRepayType").value = debt.repaymentType || "annuity";
            syncCustomSelect("debtLoanRepayType");
            document.getElementById("debtLoanTerm").value = debt.termMonths ?? "";
            document.getElementById("debtLoanFirstPaymentDate").value = debt.firstPaymentDate || "";
            document.getElementById("debtLoanFirstPaymentDate").classList.toggle("has-value", !!debt.firstPaymentDate);
            document.getElementById("debtLoanDisbursementAccount").closest("label").style.display = debt.disbursementDeposited ? "none" : "";
            document.getElementById("debtLoanDisbursementHint").style.display = debt.disbursementDeposited ? "" : "none";
        } else if (debt.type === "other") {
            document.getElementById("debtOtherBalance").value = fmt2(debt.beginningBalance);
            document.getElementById("debtOtherRepayType").value = debt.repayType || "";
            syncCustomSelect("debtOtherRepayType");
            updateOtherRepayFields();
            if (debt.repayType === "due_date") {
                document.getElementById("debtOtherDueDate").value = debt.dueDate || "";
                document.getElementById("debtOtherDueDate").classList.toggle("has-value", !!debt.dueDate);
                document.getElementById("debtOtherDueDateMode").value = debt.dueDatePayMode || "installments";
                syncCustomSelect("debtOtherDueDateMode");
                updateOtherDueDateModeFields();
                document.getElementById("debtOtherDueDateFirstPaymentDate").value = debt.firstPaymentDate || "";
                document.getElementById("debtOtherDueDateFirstPaymentDate").classList.toggle("has-value", !!debt.firstPaymentDate);
            } else if (debt.repayType === "monthly") {
                document.getElementById("debtOtherFirstPaymentDate").value = debt.firstPaymentDate || "";
                document.getElementById("debtOtherFirstPaymentDate").classList.toggle("has-value", !!debt.firstPaymentDate);
                document.getElementById("debtOtherMonthlyPayment").value = fmt2(debt.monthlyPayment);
            }
        }
        document.getElementById("debtSaveBtn").textContent = "Update debt";
        const hint = document.getElementById("debtTxHint");
        hint.textContent = "Editing this debt updates planned transactions — paid ones are kept as-is.";
        hint.style.display = "";
        const plannedCount = (data.bills || []).filter(b => b.debtId === id && b.debtGenerated && !b.paid).length;
        const delBtn = document.getElementById("debtDeletePlannedBtn");
        delBtn.style.display = plannedCount > 0 ? "" : "none";
        delBtn.textContent = `🗑️ Delete all planned payments (${plannedCount})`;
        const txGenerate = debt.txGenerate ?? true;
        document.getElementById("debtTxGenerate").checked = txGenerate;
        document.getElementById("debtTxPriority").value = debt.txPriority != null ? String(debt.txPriority) : "";
        if (txGenerate) {
            document.getElementById("debtTxFields").style.display = "";
            document.getElementById("debtTxFromAccount").value = debt.txFromAccount || "";
            updateDebtTxCCNote();
        } else {
            document.getElementById("debtTxFields").style.display = "none";
        }
    }

    updateCurrencyInputDisplay();
    document.getElementById("debtModal").classList.add("active");
}

function debtNumBlur(el) {
    const v = parseFloat(el.value);
    if (!isNaN(v)) el.value = v.toFixed(2);
}

function closeDebtModal() {
    document.getElementById("debtModal").classList.remove("active");
    if (typeof renderAll === "function") renderAll();
    else {
        renderDebts();
        if (typeof renderDebtPage === "function") renderDebtPage();
        if (typeof renderDebtSummaryCards === "function") renderDebtSummaryCards();
    }
}

function updateDebtTypeFields() {
    const type = document.getElementById("debtType").value;
    const row = document.getElementById("debtLinkedAccountRow");
    const select = document.getElementById("debtLinkedAccount");
    const ccFields = document.getElementById("debtCCFields");
    const loanFields = document.getElementById("debtLoanFields");
    const otherFields = document.getElementById("debtOtherFields");

    ccFields.classList.remove("debt-type-fields--active");
    loanFields.classList.remove("debt-type-fields--active");
    otherFields.classList.remove("debt-type-fields--active");

    if (type === "credit_card") {
        row.style.display = "";
        ccFields.classList.add("debt-type-fields--active");
        const cards = (data.accounts || []).filter(a => a.type === "credit");
        select.innerHTML = `<option value="">Select credit card</option>` +
            cards.map(a => `<option value="${a.id}">${escapeHtml(truncOpt('💳 ' + a.name, 30))}</option>`).join("") +
            `<option value="__add_cc__">+ Add Credit Card Account</option>`;
        select.onchange = function() {
            if (select.value === "__add_cc__") {
                select.value = "";
                openAccountModalWithType("credit");
                document.getElementById("accountModal").style.zIndex = "1300";
            }
            updateDebtTxCCNote();
        };
    } else if (type === "loan") {
        row.style.display = "none";
        loanFields.classList.add("debt-type-fields--active");
    } else if (type === "other") {
        row.style.display = "none";
        otherFields.classList.add("debt-type-fields--active");
        updateOtherRepayFields();
    } else {
        row.style.display = "none";
    }
    updateDebtTxCCNote();
}

function updateOtherRepayFields() {
    const repayType = document.getElementById("debtOtherRepayType").value;
    const dueDateFields = document.getElementById("debtOtherDueDateFields");
    const monthlyFields = document.getElementById("debtOtherMonthlyFields");
    dueDateFields.classList.remove("debt-type-fields--active");
    monthlyFields.classList.remove("debt-type-fields--active");
    if (repayType === "due_date") {
        dueDateFields.classList.add("debt-type-fields--active");
        updateOtherDueDateModeFields();
    } else if (repayType === "monthly") {
        monthlyFields.classList.add("debt-type-fields--active");
    }
}

function updateOtherDueDateModeFields() {
    const mode = document.getElementById("debtOtherDueDateMode").value;
    const firstPaymentFields = document.getElementById("debtOtherDueDateFirstPaymentFields");
    firstPaymentFields.classList.toggle("debt-type-fields--active", mode === "installments");
}

function populateDebtTxFromAccount() {
    const selFrom = document.getElementById("debtTxFromAccount");
    const selPriority = document.getElementById("debtTxPriority");
    if (!selFrom || !selPriority) return;
    const accounts = (data.accounts || []).filter(a => a.type === "bank" || a.type === "cash");
    selFrom.innerHTML = `<option value="">Select account</option>` +
        accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
    const priorityNames = Array.isArray(data.priorityNames) && data.priorityNames.some(n => n.trim())
        ? data.priorityNames : defaultData.priorityNames;
    const currentVal = selPriority.value;
    selPriority.innerHTML = `<option value="">Select priority</option>` + priorityNames
        .map((name, i) => `<option value="${i}">${escapeHtml(name || `Priority ${i + 1}`)}</option>`)
        .join("");
    selPriority.value = currentVal !== "" ? currentVal : "";
}

function updateDebtTxCCNote() {
    const type = document.getElementById("debtType").value;
    const noteEl = document.getElementById("debtTxCCNote");
    const noteText = document.getElementById("debtTxCCNoteText");
    if (!noteEl) return;
    if (type === "credit_card") {
        const linkedId = document.getElementById("debtLinkedAccount").value;
        const card = (data.accounts || []).find(a => a.id === linkedId);
        if (card) {
            noteText.textContent = `Payment will be applied to: ${card.name}`;
            noteEl.style.display = "";
        } else {
            noteEl.style.display = "none";
        }
    } else {
        noteEl.style.display = "none";
    }
}

function toggleDebtTxFields() {
    const checked = document.getElementById("debtTxGenerate").checked;
    const wrap = document.getElementById("debtTxFields");
    if (checked) {
        wrap.style.display = "";
        populateDebtTxFromAccount();
        updateDebtTxCCNote();
    } else {
        wrap.style.display = "none";
    }
}

function saveDebt() {
    const name = document.getElementById("debtName").value.trim();
    const type = document.getElementById("debtType").value;
    const linkedAccountId = type === "credit_card" ? (document.getElementById("debtLinkedAccount").value || null) : null;

    const aprRaw = document.getElementById("debtApr").value.trim();
    const apr = aprRaw !== "" ? parseFloat(aprRaw) : null;
    const creditLimit = type === "credit_card" ? parseFloat(document.getElementById("debtCCLimit").value) || 0 : 0;
    const minPayment = type === "credit_card" ? parseFloat(document.getElementById("debtCCMinPayment").value) || 0 : 0;
    const plannedPayment = type === "credit_card" ? parseFloat(document.getElementById("debtCCPlannedPayment").value) || 0 : 0;
    const balance = type === "loan" ? parseFloat(document.getElementById("debtLoanBalance").value) || 0
                 : type === "other" ? parseFloat(document.getElementById("debtOtherBalance").value) || 0 : 0;
    const term = type === "loan" ? parseInt(document.getElementById("debtLoanTerm").value) || 0 : 0;
    const firstPaymentDate = type === "loan" ? document.getElementById("debtLoanFirstPaymentDate").value : "";
    const otherRepayType = type === "other" ? document.getElementById("debtOtherRepayType").value : "";
    const otherFirstPaymentDate = otherRepayType === "monthly" ? document.getElementById("debtOtherFirstPaymentDate").value : "";
    const otherDueDate = type === "other" ? document.getElementById("debtOtherDueDate").value : "";
    const otherMonthlyPayment = type === "other" ? parseFloat(document.getElementById("debtOtherMonthlyPayment").value) || 0 : 0;
    const otherDueDateMode = otherRepayType === "due_date" ? document.getElementById("debtOtherDueDateMode").value : "";
    const otherDueDateFirstPaymentDate = otherDueDateMode === "installments" ? document.getElementById("debtOtherDueDateFirstPaymentDate").value : "";

    let hasError = false;
    const setErr = (id, err) => {
        const el = document.getElementById(id);
        const wrap = el.closest(".amount-input-wrap");
        if (wrap) {
            wrap.classList[err ? "add" : "remove"]("field-error");
        } else {
            el.classList[err ? "add" : "remove"]("field-error");
        }
        if (el.tagName === "SELECT") {
            const lbl = el.closest("label");
            if (lbl) lbl.classList[err ? "add" : "remove"]("field-error");
        }
    };

    setErr("debtName", !name);             if (!name) hasError = true;
    setErr("debtType", !type);             if (!type) hasError = true;
    const aprMissing = apr === null;
    setErr("debtApr", aprMissing); if (aprMissing) hasError = true;
    const ccFirstPaymentDate = type === "credit_card" ? document.getElementById("debtCCFirstPaymentDate").value : "";
    if (type === "credit_card") {
        setErr("debtLinkedAccount", !linkedAccountId);           if (!linkedAccountId) hasError = true;
        setErr("debtCCMinPayment", !minPayment);                 if (!minPayment) hasError = true;
        setErr("debtCCLimit", !creditLimit);                     if (!creditLimit) hasError = true;
        setErr("debtCCFirstPaymentDate", !ccFirstPaymentDate);   if (!ccFirstPaymentDate) hasError = true;
    }
    if (type === "loan") {
        setErr("debtLoanBalance", !balance);               if (!balance) hasError = true;
        setErr("debtLoanTerm", !term);                     if (!term) hasError = true;
        setErr("debtLoanFirstPaymentDate", !firstPaymentDate); if (!firstPaymentDate) hasError = true;
    }
    if (type === "other") {
        setErr("debtOtherBalance", !balance);              if (!balance) hasError = true;
        setErr("debtOtherRepayType", !otherRepayType);     if (!otherRepayType) hasError = true;
        if (otherRepayType === "due_date") {
            setErr("debtOtherDueDate", !otherDueDate);     if (!otherDueDate) hasError = true;
            if (otherDueDateMode === "installments") {
                setErr("debtOtherDueDateFirstPaymentDate", !otherDueDateFirstPaymentDate);
                if (!otherDueDateFirstPaymentDate) hasError = true;
            }
        }
        if (otherRepayType === "monthly") {
            setErr("debtOtherFirstPaymentDate", !otherFirstPaymentDate); if (!otherFirstPaymentDate) hasError = true;
            setErr("debtOtherMonthlyPayment", !otherMonthlyPayment);     if (!otherMonthlyPayment) hasError = true;
        }
    }
    const txGenerate = document.getElementById("debtTxGenerate").checked;
    const txFromAccountEl = document.getElementById("debtTxFromAccount");
    const txPriorityEl = document.getElementById("debtTxPriority");
    if (txGenerate) {
        setErr("debtTxFromAccount", !txFromAccountEl.value); if (!txFromAccountEl.value) hasError = true;
        setErr("debtTxPriority", !txPriorityEl.value);       if (!txPriorityEl.value) hasError = true;
    }

    if (hasError) return;

    // Every transaction generated for a debt shares the debt's own id as seriesId (one
    // series per debt, no matter how many installments it generates) — so the demo's
    // series-count gate applies here exactly like it does for a new recurring bill: only
    // when this debt is about to generate a series that doesn't already exist.
    const editingDebtId = document.getElementById("debtModal")._editingId || null;
    const existingSeriesIds = new Set(data.bills.map(b => b.seriesId));
    const isNewSeriesForThisDebt = txGenerate && (!editingDebtId || !existingSeriesIds.has(editingDebtId));
    if (isNewSeriesForThisDebt && !isActivated() && existingSeriesIds.size >= 2) {
        closeDebtModal();
        showActivationModal();
        return;
    }

    const notes = document.getElementById("debtNotes").value.trim();
    const txFromAccount = txGenerate ? (txFromAccountEl.value || null) : null;
    const txPriority = txGenerate ? parseInt(txPriorityEl.value) : 1;
    let debtData = { name, type, linkedAccountId, apr: apr ?? 0, notes, txGenerate, txFromAccount, txPriority };

    if (type === "credit_card") {
        debtData.minPayment = minPayment;
        debtData.plannedPayment = plannedPayment || null;
        debtData.firstPaymentDate = ccFirstPaymentDate;
        const accIdx = data.accounts.findIndex(a => a.id === linkedAccountId);
        if (accIdx !== -1 && creditLimit) data.accounts[accIdx].creditLimit = creditLimit;
    } else if (type === "loan") {
        debtData.beginningBalance = balance;
        debtData.rateType = document.getElementById("debtLoanRateType").value;
        debtData.repaymentType = document.getElementById("debtLoanRepayType").value;
        debtData.termMonths = term;
        debtData.firstPaymentDate = firstPaymentDate;
    } else if (type === "other") {
        debtData.beginningBalance = balance;
        debtData.repayType = otherRepayType;
        if (otherRepayType === "due_date") {
            debtData.dueDate = otherDueDate;
            debtData.dueDatePayMode = otherDueDateMode;
            debtData.firstPaymentDate = otherDueDateMode === "installments" ? otherDueDateFirstPaymentDate : "";
        }
        if (otherRepayType === "monthly") {
            debtData.firstPaymentDate = otherFirstPaymentDate;
            debtData.monthlyPayment = otherMonthlyPayment;
        }
    }

    const editingId = document.getElementById("debtModal")._editingId;
    let savedDebt;
    if (editingId) {
        data.debts = data.debts.map(d => d.id === editingId ? { ...d, ...debtData } : d);
        savedDebt = data.debts.find(d => d.id === editingId);
    } else {
        savedDebt = { id: crypto.randomUUID(), ...debtData };
        data.debts.push(savedDebt);
        if (typeof insertNewDebtIntoPlanLock === 'function') insertNewDebtIntoPlanLock(savedDebt.id);
    }

    if (txGenerate && typeof generateDebtTransactions === 'function') {
        generateDebtTransactions(savedDebt);
        if (type === "credit_card") {
            const genCount = data.bills.filter(b => b.debtId === savedDebt.id && b.debtGenerated && !b.paid).length;
            if (genCount === 0) {
                alert("No payment plan was generated — the linked account currently shows no balance owed. If that's not right, update the account's balance in Bank Accounts.");
            }
        }
    } else if (!txGenerate) {
        data.bills = data.bills.filter(b => !(b.debtId === savedDebt.id && b.debtGenerated && !b.paid));
    }

    if (type === "loan") {
        const disbursementAccountId = document.getElementById("debtLoanDisbursementAccount").value || null;
        if (disbursementAccountId && !savedDebt.disbursementDeposited) {
            data.bills.push({
                id: crypto.randomUUID(),
                seriesId: crypto.randomUUID(),
                name: "Account Transfer",
                category: "Transfers",
                type: "payment",
                amount: balance,
                actualAmount: null,
                dueDate: toLocalDateInputValue(new Date()),
                actualDate: null,
                priority: 1,
                frequency: "one-time",
                interval: 1,
                endDate: null,
                notes: `Loan disbursement — ${name}`,
                paid: true,
                fromAccount: "external",
                toAccount: disbursementAccountId
            });
            savedDebt.disbursementDeposited = true;
        }
    }

    saveData();
    closeDebtModal();
}

function deleteDebtFromModal() {
    const id = document.getElementById("debtModal")._editingId;
    if (!id) return;
    const usedInBills = data.bills.some(b => b.debtId === id);
    const msg = usedInBills
        ? "This debt is used in existing transactions. Deleting it will also delete its planned (unpaid) generated transactions. Paid transactions are kept, only unlinked. Continue?"
        : "Delete this debt?";
    if (!confirm(msg)) return;
    if (usedInBills) {
        data.bills = data.bills.filter(b => !(b.debtId === id && b.debtGenerated && !b.paid));
        data.bills = data.bills.map(b => b.debtId === id ? { ...b, debtId: null } : b);
    }
    data.debts = data.debts.filter(d => d.id !== id);
    saveData();
    closeDebtModal();
}

function renderDebts() {
    const container = document.getElementById("debtsList");
    if (!container) return;
    const typeEmoji = { credit_card: "💳", loan: "🏦", other: "📋" };
    container.innerHTML = (data.debts || []).map(d => {
        return `<div class="bill-name-row" draggable="false" data-id="${d.id}" onclick="openDebtModal('${d.id}')">
            <span class="bill-name-handle"><svg width="10" height="14" viewBox="0 0 10 14" fill="none"><circle cx="3" cy="2.5" r="1.2" fill="#aaa"/><circle cx="7" cy="2.5" r="1.2" fill="#aaa"/><circle cx="3" cy="7" r="1.2" fill="#aaa"/><circle cx="7" cy="7" r="1.2" fill="#aaa"/><circle cx="3" cy="11.5" r="1.2" fill="#aaa"/><circle cx="7" cy="11.5" r="1.2" fill="#aaa"/></svg></span>
            <span class="bill-name-input debt-name-span">${typeEmoji[d.type] || "📋"} ${escapeHtml(d.name)}</span>
        </div>`;
    }).join("");

    container.querySelectorAll(".bill-name-row[data-id]").forEach(item => {
        const handle = item.querySelector(".bill-name-handle");
        handle.addEventListener("mousedown", () => item.setAttribute("draggable", "true"));
        item.addEventListener("mouseup", () => item.setAttribute("draggable", "false"));
        item.addEventListener("dragstart", e => {
            window._debtDragSrc = item;
            item.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        item.addEventListener("dragend", () => {
            window._debtDragSrc = null;
            item.classList.remove("dragging");
            container.querySelectorAll(".bill-name-row").forEach(i => i.classList.remove("drag-over"));
            const ids = [...container.querySelectorAll(".bill-name-row[data-id]")].map(i => i.dataset.id);
            if (ids.length > 0) {
                data.debts = ids.map(id => data.debts.find(d => d.id === id)).filter(Boolean);
                saveData();
            }
        });
        item.addEventListener("dragover", e => {
            e.preventDefault();
            if (window._debtDragSrc && window._debtDragSrc !== item) item.classList.add("drag-over");
        });
        item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
        item.addEventListener("drop", e => {
            e.preventDefault();
            item.classList.remove("drag-over");
            if (!window._debtDragSrc || window._debtDragSrc === item) return;
            const items = [...container.querySelectorAll(".bill-name-item")];
            const srcIdx = items.indexOf(window._debtDragSrc);
            const tgtIdx = items.indexOf(item);
            if (srcIdx < tgtIdx) container.insertBefore(window._debtDragSrc, item.nextSibling);
            else container.insertBefore(window._debtDragSrc, item);
        });
    });
}

function scrollToAccounts() {
    const el = document.getElementById("accountsColsGrid");
    if (el) el.scrollIntoView({ behavior: "smooth" });
}

function archiveDebt() {
    const id = document.getElementById("debtModal")._editingId;
    if (!id) return;
    const idx = (data.debts || []).findIndex(d => d.id === id);
    if (idx === -1) return;
    data.debts[idx] = { ...data.debts[idx], archived: !data.debts[idx].archived };
    saveData();
    closeDebtModal();
}

window.openDebtModal = openDebtModal;
window.closeDebtModal = closeDebtModal;
window.updateDebtTypeFields = updateDebtTypeFields;
window.updateOtherRepayFields = updateOtherRepayFields;
window.toggleDebtTxFields = toggleDebtTxFields;

function deleteDebtPlannedTransactions() {
    const id = document.getElementById("debtModal")._editingId;
    if (!id) return;
    const count = (data.bills || []).filter(b => b.debtId === id && b.debtGenerated && !b.paid).length;
    if (!count) return;
    if (!confirm(`Delete ${count} planned payment transaction${count !== 1 ? "s" : ""} for this debt? Paid transactions are not affected.`)) return;
    data.bills = data.bills.filter(b => !(b.debtId === id && b.debtGenerated && !b.paid));
    saveData();
    const delBtn = document.getElementById("debtDeletePlannedBtn");
    delBtn.style.display = "none";
}
window.deleteDebtPlannedTransactions = deleteDebtPlannedTransactions;
window.saveDebt = saveDebt;
window.deleteDebtFromModal = deleteDebtFromModal;
window.archiveDebt = archiveDebt;
window.scrollToAccounts = scrollToAccounts;
window.closeAccountModal = closeAccountModal;
window.saveAccount = saveAccount;
window.deleteAccount = deleteAccount;


// ============================================================
// ACCOUNTS COLUMNS VIEW
// ============================================================

function renderAccountsCols() {
    const container = document.getElementById("accountsColsGrid");
    if (!container) return;

    container.innerHTML = ACC_COL_TYPES.map(col => {
        const accounts = (data.accounts || []).filter(a => a.type === col.type);
        const items = accounts.map(acc => `
            <div class="acc-col-item" draggable="false" data-id="${acc.id}" onclick="openAccountModal('${acc.id}')">
                <span class="acc-col-item-handle"><svg width="10" height="14" viewBox="0 0 10 14" fill="none"><circle cx="3" cy="2.5" r="1.2" fill="#aaa"/><circle cx="7" cy="2.5" r="1.2" fill="#aaa"/><circle cx="3" cy="7" r="1.2" fill="#aaa"/><circle cx="7" cy="7" r="1.2" fill="#aaa"/><circle cx="3" cy="11.5" r="1.2" fill="#aaa"/><circle cx="7" cy="11.5" r="1.2" fill="#aaa"/></svg></span>
                <span class="acc-col-item-name">${escapeHtml(acc.name)}</span>
            </div>`).join("");

        return `
        <div class="acc-col ${col.cls}" data-type="${col.type}">
            <div class="acc-col-title"><span class="help-icon" data-help-title="${col.emoji} ${col.label}" data-help="${col.help}" style="cursor:pointer;">${col.emoji}</span> ${col.label}</div>
            <div class="acc-col-items" data-type="${col.type}">${items}</div>
            <button class="acc-col-add" onclick="openAccountModalWithType('${col.type}')">+ Add account</button>
        </div>`;
    }).join("");

    initAccountColsDrag();
}

function openAccountModalWithType(type) {
    openAccountModal(null);
    const col = ACC_COL_TYPES.find(c => c.type === type);
    const typeEl = document.getElementById("accountType");
    if (typeEl) typeEl.value = type;
    document.getElementById("accountModal").classList.add("from-col");
    document.getElementById("accountTypeRow").style.display = "none";
    const limitRow = document.getElementById("accountCreditLimitRow");
    if (limitRow) limitRow.style.display = type === "credit" ? "" : "none";
    if (col) {
        const title = document.getElementById("accountModalTitle");
        if (title) title.textContent = `${col.emoji} Add ${col.label} Account`;
        const balIcon = document.querySelectorAll("#accountModal .help-icon")[2];
        if (balIcon) balIcon.setAttribute("data-help", col.help);
        const nameIcon = document.getElementById("accountNameHelpIcon");
        if (nameIcon) nameIcon.setAttribute("data-help", col.nameHelp);
        const nameEl = document.getElementById("accountName");
        if (nameEl) nameEl.placeholder = col.namePlaceholder;
    }
}

function initAccountColsDrag() {
    const container = document.getElementById("accountsColsGrid");
    if (!container) return;

    let dragSrc = null;

    container.querySelectorAll(".acc-col-item").forEach(item => {
        const handle = item.querySelector(".acc-col-item-handle");
        if (handle) {
            handle.addEventListener("mousedown", () => item.setAttribute("draggable", "true"));
            item.addEventListener("mouseup", () => item.setAttribute("draggable", "false"));
        }
        item.addEventListener("dragstart", function() {
            dragSrc = this;
            this.classList.add("dragging");
        });
        item.addEventListener("dragend", function() {
            this.classList.remove("dragging");
            this.setAttribute("draggable", "false");
            dragSrc = null;
        });
        item.addEventListener("dragover", function(e) {
            e.preventDefault();
        });
        item.addEventListener("drop", function(e) {
            e.preventDefault();
            if (!dragSrc || dragSrc === this) return;

            const srcId = dragSrc.dataset.id;
            const tgtId = this.dataset.id;
            const srcType = dragSrc.closest(".acc-col-items").dataset.type;
            const tgtType = this.closest(".acc-col-items").dataset.type;

            if (srcType !== tgtType) return;

            const srcIdx = data.accounts.findIndex(a => a.id === srcId);
            const tgtIdx = data.accounts.findIndex(a => a.id === tgtId);
            if (srcIdx === -1 || tgtIdx === -1) return;

            const moved = data.accounts.splice(srcIdx, 1)[0];
            data.accounts.splice(tgtIdx, 0, moved);

            saveData();
            renderAccountsCols();
        });
    });
}

window.openAccountModalWithType = openAccountModalWithType;

// ============================================================
// SAVINGS GOALS
// ============================================================

function renderSavingsGoals() {
    const container = document.getElementById("savingsGoalsList");
    if (!container) return;
    const svgDots = `<svg width="10" height="14" viewBox="0 0 10 14" fill="none"><circle cx="3" cy="2.5" r="1.2" fill="#aaa"/><circle cx="7" cy="2.5" r="1.2" fill="#aaa"/><circle cx="3" cy="7" r="1.2" fill="#aaa"/><circle cx="7" cy="7" r="1.2" fill="#aaa"/><circle cx="3" cy="11.5" r="1.2" fill="#aaa"/><circle cx="7" cy="11.5" r="1.2" fill="#aaa"/></svg>`;
    container.innerHTML = (data.savingsGoals || []).filter(g => !g.archived).map(g =>
        `<div class="bill-name-row" draggable="false" data-id="${g.id}" onclick="openSavingsGoalModal('${g.id}')">
            <span class="bill-name-handle">${svgDots}</span>
            <span class="bill-name-input debt-name-span">${escapeHtml(g.name)}</span>
        </div>`
    ).join("");

    container.querySelectorAll(".bill-name-row[data-id]").forEach(item => {
        const handle = item.querySelector(".bill-name-handle");
        handle.addEventListener("mousedown", () => item.setAttribute("draggable", "true"));
        item.addEventListener("mouseup", () => item.setAttribute("draggable", "false"));
        item.addEventListener("dragstart", e => {
            window._sgDragSrc = item;
            item.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        item.addEventListener("dragend", () => {
            window._sgDragSrc = null;
            item.classList.remove("dragging");
            container.querySelectorAll(".bill-name-row").forEach(i => i.classList.remove("drag-over"));
            const ids = [...container.querySelectorAll(".bill-name-row[data-id]")].map(i => i.dataset.id);
            if (ids.length) {
                data.savingsGoals = ids.map(id => (data.savingsGoals || []).find(g => g.id === id)).filter(Boolean);
                saveData();
            }
        });
        item.addEventListener("dragover", e => {
            e.preventDefault();
            if (window._sgDragSrc && window._sgDragSrc !== item) item.classList.add("drag-over");
        });
        item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
        item.addEventListener("drop", e => {
            e.preventDefault();
            item.classList.remove("drag-over");
            if (!window._sgDragSrc || window._sgDragSrc === item) return;
            if (e.target.compareDocumentPosition(window._sgDragSrc) & Node.DOCUMENT_POSITION_FOLLOWING)
                container.insertBefore(window._sgDragSrc, item);
            else
                container.insertBefore(window._sgDragSrc, item.nextSibling);
        });
    });
}

function initAccWarningTipOutsideClose() {
    if (window._accWarningTipOutsideCloseBound) return;
    window._accWarningTipOutsideCloseBound = true;
    document.addEventListener("click", function(e) {
        const openTip = window._openAccWarningTip;
        if (!openTip) return;
        if (openTip.tip.contains(e.target) || openTip.trigger.contains(e.target)) return;
        openTip.tip.style.display = "none";
        window._openAccWarningTip = null;
    });
}

function populateSavingsGoalAccountDropdown(selectedId) {
    const select = document.getElementById("savingsGoalAccount");
    if (!select) return;
    const savingsAccounts = (data.accounts || []).filter(a => a.type === "savings");
    select.disabled = false;
    select.innerHTML = `<option value="">No linked account</option>` +
        savingsAccounts.map(a =>
            `<option value="${a.id}"${a.id === selectedId ? " selected" : ""}>${escapeHtml(truncOpt(a.name, 30))}</option>`
        ).join("") +
        (savingsAccounts.length > 0 ? `<option value="__add_new__">+ Add Savings Account</option>` : "");

    const label = select.closest("label");
    if (label) {
        label.style.position = "relative";
        let tip = document.getElementById("savingsAccTip");
        if (tip) tip.remove();
        if (savingsAccounts.length === 0) {
            tip = document.createElement("div");
            tip.id = "savingsAccTip";
            tip.style.cssText = "display:none;position:fixed;min-width:300px;max-width:340px;z-index:2000;background:#fff3f3;border:1.5px solid #d0323c;border-radius:8px;padding:8px 12px;font-size:12px;color:#d0323c;box-shadow:0 4px 12px rgba(0,0,0,0.15);";
            tip.innerHTML = "⚠️ No savings accounts found. Go to <strong>Settings → Bank Accounts</strong> and add a Savings account first, or <button onclick=\"event.stopPropagation();openAccountModalWithType('savings');document.getElementById('accountModal').style.zIndex='1300';\" style=\"background:none;border:none;padding:0;font:inherit;font-size:inherit;color:#d0323c;text-decoration:underline;cursor:pointer;font-weight:600;\">add one now</button>.";
            document.body.appendChild(tip);
            initAccWarningTipOutsideClose();
            if (!label.dataset.accTipBound) {
                label.dataset.accTipBound = "true";
                label.addEventListener("click", function(e) {
                    if (e.target.closest(".help-icon")) return;
                    const curTip = document.getElementById("savingsAccTip");
                    if (!curTip) return;
                    e.stopPropagation();
                    e.preventDefault();
                    const isOpen = curTip.style.display === "block";
                    if (isOpen) {
                        curTip.style.display = "none";
                        window._openAccWarningTip = null;
                    } else {
                        const r = label.getBoundingClientRect();
                        curTip.style.right = (window.innerWidth - r.right) + "px";
                        curTip.style.bottom = (window.innerHeight - r.top + 4) + "px";
                        curTip.style.display = "block";
                        window._openAccWarningTip = { tip: curTip, trigger: label };
                    }
                }, true);
            }
            select.onchange = null;
        } else {
            select.onclick = null;
            select.onchange = function() {
                if (select.value !== "__add_new__") return;
                select.value = selectedId || "";
                openAccountModalWithType("savings");
                document.getElementById("accountModal").style.zIndex = "1300";
            };
        }
    }
}

function openSavingsGoalModal(id) {
    const modal = document.getElementById("savingsGoalModal");
    document.getElementById("savingsGoalModalTitle").textContent = "🐷 Add Savings Fund";
    document.getElementById("savingsGoalName").value = "";
    document.getElementById("savingsGoalAmount").value = "";
    document.getElementById("savingsGoalStartAmount").value = "";
    document.getElementById("savingsGoalStartDate").value = "";
    document.getElementById("savingsGoalStartDate").classList.remove("has-value");
    document.getElementById("savingsGoalGoalDate").value = "";
    document.getElementById("savingsGoalGoalDate").classList.remove("has-value");
    document.getElementById("savingsMonthlyContribution").value = "";
    document.getElementById("savingsGoalNotes").value = "";
    document.getElementById("savingsGoalDeleteBtn").style.display = "none";
    document.getElementById("savingsGoalArchiveBtn").style.display = "none";
    document.getElementById("savingsTxGenerate").checked = false;
    toggleSavingsTxFields();
    document.getElementById("savingsTxHint").style.display = "none";
    document.getElementById("savingsDeletePlannedBtn").style.display = "none";
    modal._editingId = null;
    populateSavingsGoalAccountDropdown(null);
    updateSavingsContributionFieldVisibility();

    if (id) {
        const goal = (data.savingsGoals || []).find(g => g.id === id);
        if (goal) {
            document.getElementById("savingsGoalModalTitle").textContent = "✏️ Edit Savings Fund";
            document.getElementById("savingsGoalName").value = goal.name || "";
            document.getElementById("savingsGoalAmount").value = Number(goal.goalAmount ?? 0).toFixed(2);
            document.getElementById("savingsGoalStartAmount").value = Number(goal.startAmount ?? 0).toFixed(2);
            const sdEl = document.getElementById("savingsGoalStartDate");
            const gdEl = document.getElementById("savingsGoalGoalDate");
            sdEl.value = goal.startDate || "";
            sdEl.classList.toggle("has-value", !!goal.startDate);
            gdEl.value = goal.goalDate || "";
            gdEl.classList.toggle("has-value", !!goal.goalDate);
            document.getElementById("savingsMonthlyContribution").value = goal.monthlyContribution != null ? Number(goal.monthlyContribution).toFixed(2) : "";
            document.getElementById("savingsGoalNotes").value = goal.notes || "";
            document.getElementById("savingsGoalDeleteBtn").style.display = "";
            const archiveBtn = document.getElementById("savingsGoalArchiveBtn");
            archiveBtn.style.display = "";
            archiveBtn.textContent = goal.archived ? "Unarchive" : "Archive";
            modal._editingId = id;
            populateSavingsGoalAccountDropdown(goal.accountId);
            updateSavingsContributionFieldVisibility();

            document.getElementById("savingsTxGenerate").checked = !!goal.txGenerate;
            toggleSavingsTxFields();
            if (goal.txGenerate) {
                document.getElementById("savingsTxFromAccount").value = goal.txFromAccount || "";
                document.getElementById("savingsTxPriority").value = goal.txPriority != null ? String(goal.txPriority) : "";
            }
            const plannedCount = (data.bills || []).filter(b => b.savingsGoalId === id && b.savingsGenerated && !b.paid).length;
            const delBtn = document.getElementById("savingsDeletePlannedBtn");
            delBtn.style.display = plannedCount > 0 ? "" : "none";
            delBtn.textContent = `🗑️ Delete all planned contributions (${plannedCount})`;
        }
    }

    updateCurrencyInputDisplay();
    modal.classList.add("active");
}

function updateSavingsContributionFieldVisibility() {
    const hasGoalDate = !!document.getElementById("savingsGoalGoalDate").value;
    document.getElementById("savingsMonthlyContributionWrap").classList.toggle("debt-type-fields--active", !hasGoalDate);
}

function populateSavingsTxFromAccount() {
    const selFrom = document.getElementById("savingsTxFromAccount");
    const selPriority = document.getElementById("savingsTxPriority");
    if (!selFrom || !selPriority) return;
    const accounts = (data.accounts || []).filter(a => a.type === "bank" || a.type === "cash");
    selFrom.innerHTML = `<option value="">Select account</option>` +
        accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
    const priorityNames = Array.isArray(data.priorityNames) && data.priorityNames.some(n => n.trim())
        ? data.priorityNames : defaultData.priorityNames;
    const currentVal = selPriority.value;
    selPriority.innerHTML = `<option value="">Select priority</option>` + priorityNames
        .map((name, i) => `<option value="${i}">${escapeHtml(name || `Priority ${i + 1}`)}</option>`)
        .join("");
    selPriority.value = currentVal !== "" ? currentVal : "";
}

function toggleSavingsTxFields() {
    const checked = document.getElementById("savingsTxGenerate").checked;
    const wrap = document.getElementById("savingsTxFields");
    if (checked) {
        wrap.style.display = "";
        populateSavingsTxFromAccount();
    } else {
        wrap.style.display = "none";
    }
    const optionalTag = document.getElementById("savingsGoalAccountOptionalTag");
    if (optionalTag) optionalTag.style.display = checked ? "none" : "";
}

function deleteSavingsPlannedTransactions() {
    const id = document.getElementById("savingsGoalModal")._editingId;
    if (!id) return;
    const count = (data.bills || []).filter(b => b.savingsGoalId === id && b.savingsGenerated && !b.paid).length;
    if (!count) return;
    if (!confirm(`Delete ${count} planned contribution transaction${count !== 1 ? "s" : ""} for this fund? Paid transactions are not affected.`)) return;
    data.bills = data.bills.filter(b => !(b.savingsGoalId === id && b.savingsGenerated && !b.paid));
    saveData();
    const delBtn = document.getElementById("savingsDeletePlannedBtn");
    delBtn.style.display = "none";
}
window.deleteSavingsPlannedTransactions = deleteSavingsPlannedTransactions;

function closeSavingsGoalModal() {
    document.getElementById("savingsGoalModal").classList.remove("active");
    document.getElementById("savingsAccTip")?.remove();
    window._openAccWarningTip = null;
}

function saveSavingsGoal() {
    const name = document.getElementById("savingsGoalName").value.trim();
    if (!name) { document.getElementById("savingsGoalName").focus(); return; }

    const goalAmountEl = document.getElementById("savingsGoalAmount");
    const startAmountEl = document.getElementById("savingsGoalStartAmount");
    const startDateEl = document.getElementById("savingsGoalStartDate");

    if (startAmountEl.value === "") { startAmountEl.focus(); return; }
    if (goalAmountEl.value === "") { goalAmountEl.focus(); return; }
    if (!startDateEl.value) { startDateEl.focus(); return; }

    const goalAmount = parseFloat(goalAmountEl.value) || 0;
    const startAmount = parseFloat(startAmountEl.value) || 0;
    const startDate = startDateEl.value;
    const goalDate = document.getElementById("savingsGoalGoalDate").value || null;
    const accountId = document.getElementById("savingsGoalAccount").value || null;
    const notes = document.getElementById("savingsGoalNotes").value.trim() || null;
    const monthlyContributionEl = document.getElementById("savingsMonthlyContribution");
    const monthlyContribution = !goalDate ? (parseFloat(monthlyContributionEl.value) || 0) : null;

    const txGenerate = document.getElementById("savingsTxGenerate").checked;
    const txFromAccountEl = document.getElementById("savingsTxFromAccount");
    const txPriorityEl = document.getElementById("savingsTxPriority");

    if (txGenerate) {
        if (!accountId) { document.getElementById("savingsGoalAccount").focus(); return; }
        if (!txFromAccountEl.value) { txFromAccountEl.focus(); return; }
        if (!txPriorityEl.value) { txPriorityEl.focus(); return; }
        if (!goalDate && !monthlyContribution) { monthlyContributionEl.focus(); return; }
    }
    const txFromAccount = txGenerate ? (txFromAccountEl.value || null) : null;
    const txPriority = txGenerate ? parseInt(txPriorityEl.value) : 1;

    const modal = document.getElementById("savingsGoalModal");
    const editingId = modal._editingId;
    const goalData = { name, goalAmount, startAmount, startDate, goalDate, accountId, notes, monthlyContribution, txGenerate, txFromAccount, txPriority };
    let savedGoal;

    if (editingId) {
        const idx = (data.savingsGoals || []).findIndex(g => g.id === editingId);
        if (idx !== -1) {
            const oldName = data.savingsGoals[idx].name;
            data.savingsGoals[idx] = { ...data.savingsGoals[idx], ...goalData };
            savedGoal = data.savingsGoals[idx];
            if (oldName !== name) {
                data.bills = data.bills.map(b =>
                    isSavingsCategory(b.category) && b.name === oldName ? { ...b, name } : b
                );
            }
        }
    } else {
        savedGoal = { id: crypto.randomUUID(), ...goalData };
        data.savingsGoals = data.savingsGoals || [];
        data.savingsGoals.push(savedGoal);
    }

    if (txGenerate && typeof generateSavingsTransactions === 'function') {
        generateSavingsTransactions(savedGoal);
    } else if (!txGenerate) {
        data.bills = data.bills.filter(b => !(b.savingsGoalId === savedGoal.id && b.savingsGenerated && !b.paid));
    }

    saveData();
    renderSavingsGoals();
    renderSavingsPage();
    closeSavingsGoalModal();
}

function deleteSavingsGoalFromModal() {
    const id = document.getElementById("savingsGoalModal")._editingId;
    if (!id) return;
    const goal = (data.savingsGoals || []).find(g => g.id === id);
    const usedInBills = (data.bills || []).some(b => isSavingsCategory(b.category) && b.name === goal.name);
    const msg = usedInBills
        ? "This fund has existing transactions. Deleting the fund will not remove those transactions. Continue?"
        : "Delete this savings fund?";
    if (!confirm(msg)) return;
    data.savingsGoals = (data.savingsGoals || []).filter(g => g.id !== id);
    saveData();
    renderSavingsGoals();
    renderSavingsPage();
    closeSavingsGoalModal();
}

function archiveSavingsGoal() {
    const id = document.getElementById("savingsGoalModal")._editingId;
    if (!id) return;
    const idx = (data.savingsGoals || []).findIndex(g => g.id === id);
    if (idx === -1) return;
    const nowArchived = !data.savingsGoals[idx].archived;
    data.savingsGoals[idx] = { ...data.savingsGoals[idx], archived: nowArchived };
    if (nowArchived) {
        data.bills = data.bills.filter(b => !(b.savingsGoalId === id && b.savingsGenerated && !b.paid));
    }
    saveData();
    renderSavingsGoals();
    renderSavingsPage();
    closeSavingsGoalModal();
}

window.openSavingsGoalModal = openSavingsGoalModal;
window.closeSavingsGoalModal = closeSavingsGoalModal;
window.saveSavingsGoal = saveSavingsGoal;
window.deleteSavingsGoalFromModal = deleteSavingsGoalFromModal;
window.archiveSavingsGoal = archiveSavingsGoal;
window.updateSavingsContributionFieldVisibility = updateSavingsContributionFieldVisibility;
window.toggleSavingsTxFields = toggleSavingsTxFields;