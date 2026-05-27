import {
  CSV_URL,
  addMonths,
  compareByDate,
  createTokyoDate,
  formatFullDate,
  formatIsoDate,
  formatMonthLabel,
  getCalendarDays,
  groupByDate,
  normalizeCsvRows,
  parseCsv,
  todayTokyoDate,
  uniqueVenues,
  venueColor,
} from "./utils.js";

const TODAY_ISO = formatIsoDate(todayTokyoDate());

// 絞り込み用の固定グループ。先頭一致で判定する。
const VENUE_GROUPS = [
  { key: "sakura", label: "サクラステージ", color: "#d97a4a", match: (v) => v === "サクラステージ" },
  { key: "tokyo", label: "東京研修センター", color: "#5e8fb4", match: (v) => v === "東京研修センター" },
  { key: "osaka", label: "新大阪研修センター", color: "#7ba56a", match: (v) => v === "新大阪研修センター" },
  { key: "other", label: "その他", color: "#a07ba0", match: () => true /* fallback */ },
];

function venueGroupKey(venue) {
  if (!venue) return "other";
  for (const group of VENUE_GROUPS) {
    if (group.key === "other") continue;
    if (group.match(venue)) return group.key;
  }
  return "other";
}

function venueGroupColor(venue) {
  const key = venueGroupKey(venue);
  return VENUE_GROUPS.find((g) => g.key === key)?.color ?? "#999";
}

const state = {
  allItems: [],
  filteredItems: [],
  venues: [],
  selectedVenues: new Set(),
  tsunodaOnly: false,
  currentMonth: todayTokyoDate(),
  selectedDate: null,
  activeView: "calendar",
  isLoading: false,
  errorMessage: "",
};

const elements = {
  loadingState: document.querySelector("#loadingState"),
  currentMonthLabel: document.querySelector("#currentMonthLabel"),
  venueFilters: document.querySelector("#venueFilters"),
  venueCountText: document.querySelector("#venueCountText"),
  calendarGrid: document.querySelector("#calendarGrid"),
  listContainer: document.querySelector("#listContainer"),
  listSummary: document.querySelector("#listSummary"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  detailCount: document.querySelector("#detailCount"),
  detailList: document.querySelector("#detailList"),
  errorBanner: document.querySelector("#errorBanner"),
  errorMessage: document.querySelector("#errorMessage"),
  retryBtn: document.querySelector("#retryBtn"),
  tsunodaOnlyToggle: document.querySelector("#tsunodaOnlyToggle"),
  clearFiltersBtn: document.querySelector("#clearFiltersBtn"),
  prevMonthBtn: document.querySelector("#prevMonthBtn"),
  nextMonthBtn: document.querySelector("#nextMonthBtn"),
  todayBtn: document.querySelector("#todayBtn"),
  calendarTab: document.querySelector("#calendarTab"),
  listTab: document.querySelector("#listTab"),
  calendarView: document.querySelector("#calendarView"),
  listView: document.querySelector("#listView"),
  detailDialog: document.querySelector("#detailDialog"),
  detailCloseBtn: document.querySelector("#detailCloseBtn"),
};

function init() {
  bindEvents();
  fetchSchedule();
}

function bindEvents() {
  elements.retryBtn.addEventListener("click", fetchSchedule);
  if (elements.detailCloseBtn) {
    elements.detailCloseBtn.addEventListener("click", () => elements.detailDialog?.close());
  }
  if (elements.detailDialog) {
    // クリックがダイアログ本体外（=backdrop）なら閉じる
    elements.detailDialog.addEventListener("click", (event) => {
      if (event.target === elements.detailDialog) {
        elements.detailDialog.close();
      }
    });
  }
  elements.prevMonthBtn.addEventListener("click", () => {
    state.currentMonth = addMonths(state.currentMonth, -1);
    render();
  });
  elements.nextMonthBtn.addEventListener("click", () => {
    state.currentMonth = addMonths(state.currentMonth, 1);
    render();
  });
  elements.todayBtn.addEventListener("click", () => {
    state.currentMonth = todayTokyoDate();
    render();
  });
  elements.tsunodaOnlyToggle.addEventListener("change", (event) => {
    state.tsunodaOnly = event.target.checked;
    applyFilters();
  });
  elements.clearFiltersBtn.addEventListener("click", () => {
    state.selectedVenues.clear();
    state.tsunodaOnly = false;
    elements.tsunodaOnlyToggle.checked = false;
    applyFilters();
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      renderView();
    });
  });
  elements.venueFilters.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const venue = input.value;
    if (input.checked) {
      state.selectedVenues.add(venue);
    } else {
      state.selectedVenues.delete(venue);
    }
    applyFilters();
  });
}

async function fetchSchedule() {
  setLoading(true);
  setError("");

  try {
    const response = await fetch(CSV_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const csvText = await response.text();
    const rows = parseCsv(csvText);
    const items = normalizeCsvRows(rows).sort(compareByDate);

    state.allItems = items;
    state.venues = uniqueVenues(items);

    if (!state.selectedDate) {
      const upcoming = items.find((item) => item.isoDate >= TODAY_ISO);
      state.selectedDate = upcoming?.isoDate ?? items[0]?.isoDate ?? null;
    }

    if (state.selectedDate && !items.some((item) => item.isoDate === state.selectedDate)) {
      const upcoming = items.find((item) => item.isoDate >= TODAY_ISO);
      state.selectedDate = upcoming?.isoDate ?? items[0]?.isoDate ?? null;
    }

    applyFilters();
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "不明なエラーのため取得できませんでした。";
    setError(message);
    state.allItems = [];
    state.filteredItems = [];
    state.venues = [];
    render();
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  elements.loadingState.textContent = isLoading ? "読み込み中..." : "最新データを表示";
}

function setError(message) {
  state.errorMessage = message;
  const hasError = message !== "";
  elements.errorBanner.classList.toggle("is-hidden", !hasError);
  elements.errorMessage.textContent =
    message || "ネットワーク状態を確認して再試行してください。";
}

function applyFilters() {
  state.filteredItems = state.allItems.filter((item) => {
    if (state.tsunodaOnly && !item.hasTsunoda) {
      return false;
    }
    if (state.selectedVenues.size > 0) {
      const groupKey = venueGroupKey(item.venue);
      if (!state.selectedVenues.has(groupKey)) {
        return false;
      }
    }
    return true;
  });

  const filteredDates = new Set(state.filteredItems.map((item) => item.isoDate));
  const previousSelected = state.selectedDate;
  if (state.selectedDate && !filteredDates.has(state.selectedDate)) {
    const upcoming = state.filteredItems.find((item) => item.isoDate >= TODAY_ISO);
    state.selectedDate = upcoming?.isoDate ?? state.filteredItems[0]?.isoDate ?? null;
  }

  if (!state.selectedDate && state.filteredItems[0]) {
    const upcoming = state.filteredItems.find((item) => item.isoDate >= TODAY_ISO);
    state.selectedDate = upcoming?.isoDate ?? state.filteredItems[0].isoDate;
  }

  if (state.selectedDate && state.selectedDate !== previousSelected) {
    const [year, month] = state.selectedDate.split("-").map(Number);
    state.currentMonth = new Date(year, month - 1, 1, 12);
  }

  render();
}

function render() {
  elements.currentMonthLabel.textContent = formatMonthLabel(state.currentMonth);
  renderVenueFilters();
  renderView();
  renderCalendar();
  renderList();
  renderDetails();
}

function renderView() {
  const isCalendar = state.activeView === "calendar";
  elements.calendarTab.classList.toggle("is-active", isCalendar);
  elements.listTab.classList.toggle("is-active", !isCalendar);
  elements.calendarTab.setAttribute("aria-selected", String(isCalendar));
  elements.listTab.setAttribute("aria-selected", String(!isCalendar));
  elements.calendarView.classList.toggle("is-hidden", !isCalendar);
  elements.listView.classList.toggle("is-hidden", isCalendar);
}

function renderVenueFilters() {
  // 各グループに該当する件数を表示
  const counts = Object.fromEntries(VENUE_GROUPS.map((g) => [g.key, 0]));
  state.allItems.forEach((item) => {
    counts[venueGroupKey(item.venue)] += 1;
  });
  elements.venueCountText.textContent = `${VENUE_GROUPS.length}グループ`;

  elements.venueFilters.innerHTML = VENUE_GROUPS
    .map((group) => {
      const selected = state.selectedVenues.has(group.key);
      return `
        <label class="venue-option ${selected ? "is-selected" : ""}" style="color:${group.color}">
          <input type="checkbox" value="${escapeHtml(group.key)}" ${selected ? "checked" : ""} />
          <span class="venue-chip" style="background:${group.color}"></span>
          <span>${escapeHtml(group.label)}</span>
          <span class="venue-count">${counts[group.key]}</span>
        </label>
      `;
    })
    .join("");
  Array.from(elements.venueFilters.querySelectorAll("input")).forEach((input) => {
    input.checked = state.selectedVenues.has(input.value);
  });
}

function renderCalendar() {
  const itemsByDate = groupByDate(state.filteredItems);
  const days = getCalendarDays(state.currentMonth);

  elements.calendarGrid.innerHTML = days
    .map((day) => {
      const events = itemsByDate.get(day.isoDate) ?? [];
      const selected = day.isoDate === state.selectedDate;
      const isToday = day.isoDate === TODAY_ISO;
      const hasTsunoda = events.some((item) => item.hasTsunoda && !item.isBlocked);
      const isBlocked = events.some((item) => item.isBlocked);
      const classes = [
        "calendar-day",
        day.isCurrentMonth ? "" : "is-outside",
        selected ? "is-selected" : "",
        isToday ? "is-today" : "",
        hasTsunoda ? "has-tsunoda" : "",
        isBlocked ? "is-blocked" : "",
        events.length === 0 ? "is-empty" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const previewLimit = 4;
      const visibleEvents = events.slice(0, previewLimit);
      const hiddenCount = events.length - visibleEvents.length;
      const preview =
        visibleEvents
          .map((item) => {
            const color = venueGroupColor(item.venue);
            const classes = [
              "event-pill",
              item.hasTsunoda && !item.isBlocked ? "is-tsunoda" : "",
              item.isBlocked ? "is-blocked" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const title = `${item.topic || item.item || "予定"}${item.venue ? ` @ ${item.venue}` : ""}${item.timeLabel && item.timeLabel !== "時間未定" ? ` (${item.timeLabel})` : ""}`;
            return `
              <div class="${classes}" style="--pill-accent:${color}" title="${escapeHtml(title)}">
                <span class="event-pill-bar" aria-hidden="true"></span>
                <span class="event-pill-text">${escapeHtml(item.topic || item.item || "予定")}</span>
              </div>
            `;
          })
          .join("") +
        (hiddenCount > 0
          ? `<p class="calendar-day-more">＋${hiddenCount}件</p>`
          : "");

      return `
        <button
          type="button"
          class="${classes}"
          data-date="${day.isoDate}"
          aria-pressed="${selected}"
          aria-label="${formatFullDate(day.date)} ${events.length}件"
        >
          <div class="calendar-day-head">
            <span class="day-number">${day.date.getDate()}</span>
            ${renderDayMarkers(hasTsunoda, isBlocked, events.length)}
          </div>
          <div class="calendar-day-body">
            ${events.length > 0 ? `<div class="calendar-day-list">${preview}</div>` : ""}
          </div>
        </button>
      `;
    })
    .join("");

  elements.calendarGrid.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => selectDate(button.dataset.date));
    button.addEventListener("keydown", (event) => onCalendarKeydown(event, button.dataset.date));
  });
}

function renderDayMarkers(hasTsunoda, isBlocked, count) {
  const badges = [];
  if (hasTsunoda) {
    badges.push('<span class="tsunoda-dot" aria-hidden="true"></span>');
  }
  if (isBlocked) {
    badges.push('<span class="tsunoda-dot is-block" aria-hidden="true"></span>');
  }
  if (count > 0) {
    badges.push(`<span class="count-badge">${count}</span>`);
  }
  return badges.join("");
}

function renderList() {
  if (state.filteredItems.length === 0) {
    elements.listSummary.textContent = "0件";
    elements.listContainer.innerHTML = '<div class="empty-state">条件に合う予定がありません。</div>';
    return;
  }

  elements.listSummary.textContent = `${state.filteredItems.length}件`;
  elements.listContainer.innerHTML = state.filteredItems
    .map(
      (item) => `
        <button type="button" class="list-item-button" data-date="${item.isoDate}">
          <article class="list-item">
            <div class="list-item-top">
              <div class="list-date-block">
                <p class="list-date">${item.month}/${item.day}</p>
                <p class="list-weekday">${item.weekdaySymbol}曜日</p>
              </div>
              <div class="list-item-badges">
                ${renderVenueBadge(item.venue)}
                ${item.hasTsunoda ? renderTsunodaBadge(item) : ""}
              </div>
            </div>
            <div class="list-item-grid">
              <p class="list-item-title">${escapeHtml(item.topic || item.item || "予定")}</p>
              <p class="list-item-meta">${escapeHtml(item.timeLabel)} / ${escapeHtml(item.item || "項目未設定")}</p>
              <p class="list-item-meta">${escapeHtml(item.detail || "詳細未設定")}</p>
            </div>
          </article>
        </button>
      `,
    )
    .join("");

  elements.listContainer.querySelectorAll(".list-item-button").forEach((button) => {
    button.addEventListener("click", () => selectDate(button.dataset.date));
  });
}

function renderDetails() {
  const items = state.filteredItems.filter((item) => item.isoDate === state.selectedDate);

  if (!state.selectedDate || items.length === 0) {
    elements.detailTitle.textContent = "予定詳細";
    elements.detailMeta.textContent = "日付を選択すると予定が表示されます。";
    elements.detailCount.textContent = "0件";
    elements.detailList.className = "detail-list empty-state";
    elements.detailList.textContent = "現在の絞り込み条件では選択日の予定がありません。";
    return;
  }

  const date = items[0].date;
  elements.detailTitle.textContent = formatFullDate(date);
  elements.detailMeta.textContent = "トピック、時間、会場、受講生数、角田先生の予定を表示しています。";
  elements.detailCount.textContent = `${items.length}件`;
  elements.detailList.className = "detail-list";
  elements.detailList.innerHTML = items
    .map(
      (item) => `
        <article class="event-card">
          <div class="event-card-top">
            <div>
              <p class="event-card-title">${escapeHtml(item.topic || item.item || "予定")}</p>
              <p class="event-card-meta">${escapeHtml(item.item || "項目未設定")} / ${escapeHtml(item.detail || "詳細未設定")}</p>
            </div>
            <div class="event-badges">
              ${renderVenueBadge(item.venue)}
              ${item.hasTsunoda ? renderTsunodaBadge(item) : ""}
            </div>
          </div>
          <div class="event-card-grid">
            ${renderMetaPair("時間", item.timeLabel)}
            ${renderMetaPair("会場", item.venue || "会場未定")}
            ${renderMetaPair("受講生数", item.attendees || "未設定")}
            ${item.filmingTeam ? renderMetaPair("撮影チーム", item.filmingTeam) : ""}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderVenueBadge(venue) {
  if (!venue) {
    return '<span class="badge">会場未定</span>';
  }
  const color = venueGroupColor(venue);
  return `<span class="badge"><span class="mini-chip" style="background:${color}"></span>${escapeHtml(venue)}</span>`;
}

function renderTsunodaBadge(item) {
  if (item.isBlocked) {
    return '<span class="badge is-blocked">角田先生: ブロック</span>';
  }
  return `<span class="badge is-tsunoda">角田先生: ${escapeHtml(item.tsunodaRaw)}</span>`;
}

function renderMetaPair(label, value) {
  return `
    <div class="meta-pair">
      <div class="meta-label">${escapeHtml(label)}</div>
      <div class="meta-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function selectDate(isoDate, { openModal = true } = {}) {
  state.selectedDate = isoDate;
  const [year, month] = isoDate.split("-").map(Number);
  state.currentMonth = new Date(year, month - 1, 1, 12);
  render();
  if (openModal && elements.detailDialog && typeof elements.detailDialog.showModal === "function") {
    if (!elements.detailDialog.open) {
      elements.detailDialog.showModal();
    }
  }
}

function onCalendarKeydown(event, isoDate) {
  const keyMap = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectDate(isoDate);
    return;
  }

  if (!(event.key in keyMap)) {
    return;
  }

  event.preventDefault();
  const buttons = Array.from(elements.calendarGrid.querySelectorAll(".calendar-day"));
  const currentIndex = buttons.findIndex((button) => button.dataset.date === isoDate);
  const nextIndex = currentIndex + keyMap[event.key];

  if (nextIndex < 0 || nextIndex >= buttons.length) {
    return;
  }

  buttons[nextIndex].focus();
  selectDate(buttons[nextIndex].dataset.date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
