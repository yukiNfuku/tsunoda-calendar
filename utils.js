const YEAR_CANDIDATES = [2025, 2026, 2027];
const WEEKDAY_INDEX = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
};

export const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1uTx-wi6NnYr-dkIxNZ8QrZvbQjn-RJbOAU6tBj1VCPY/export?format=csv&gid=0";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function isHeaderRow(row) {
  if (!row || row.length < 2) return false;
  const joined = row.map((cell) => (cell ?? "").trim()).join("|");
  return /トピック/.test(joined) && /会場/.test(joined);
}

export function normalizeCsvRows(rows) {
  if (rows.length < 2) {
    throw new Error("CSVの行数が不足しています。");
  }

  // ヘッダ行を動的に検出（最初の2行のうち「トピック」を含む方）
  let headerIndex = 0;
  if (isHeaderRow(rows[0])) {
    headerIndex = 0;
  } else if (isHeaderRow(rows[1])) {
    headerIndex = 1;
  } else {
    throw new Error("ヘッダ行を見つけられませんでした。");
  }

  const rawItems = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => (cell ?? "").trim() !== ""));
  const inferredDates = inferYears(rawItems.map((row) => row[0] ?? ""));

  return rawItems
    .map((row, index) => {
      const dateInfo = inferredDates[index];
      if (!dateInfo) {
        return null;
      }
      const tsunodaRaw = (row[8] ?? "").trim();
      const venue = (row[6] ?? "").trim();
      const startTime = (row[4] ?? "").trim();
      const endTime = (row[5] ?? "").trim();
      const attendees = (row[7] ?? "").trim();

      return {
        id: `${dateInfo.isoDate}-${index}`,
        dateLabel: (row[0] ?? "").trim(),
        topic: (row[1] ?? "").trim(),
        item: (row[2] ?? "").trim(),
        detail: (row[3] ?? "").trim(),
        startTime,
        endTime,
        venue,
        attendees,
        tsunodaRaw,
        filmingTeam: (row[9] ?? "").trim(),
        date: dateInfo.date,
        isoDate: dateInfo.isoDate,
        monthKey: `${dateInfo.year}-${String(dateInfo.month).padStart(2, "0")}`,
        year: dateInfo.year,
        month: dateInfo.month,
        day: dateInfo.day,
        weekdaySymbol: dateInfo.weekdaySymbol,
        weekdayIndex: dateInfo.weekdayIndex,
        hasTsunoda: tsunodaRaw !== "",
        isBlocked: tsunodaRaw === "ブロック",
        timeLabel: buildTimeLabel(startTime, endTime),
      };
    })
    .filter((item) => item !== null);
}

export function inferYears(dateLabels) {
  let previous = null;

  return dateLabels.map((label) => {
    let parsed;
    try {
      parsed = parseJapaneseDateLabel(label);
    } catch (error) {
      console.warn("[tsunoda-calendar] 日付パース失敗、行をスキップ:", label);
      return null;
    }
    const candidates = YEAR_CANDIDATES.filter((year) => {
      const date = createTokyoDate(year, parsed.month, parsed.day);
      return date.getDay() === parsed.weekdayIndex;
    });

    if (candidates.length === 0) {
      console.warn("[tsunoda-calendar] 曜日に一致する年なし、行をスキップ:", label);
      return null;
    }

    let chosenYear = candidates[0];

    if (previous) {
      const notGoingBack = candidates.find((year) => {
        if (year > previous.year) {
          return true;
        }
        if (year < previous.year) {
          return false;
        }
        return parsed.month >= previous.month;
      });

      if (notGoingBack) {
        chosenYear = notGoingBack;
      } else {
        const futureCandidate = candidates.find((year) => year > previous.year);
        chosenYear = futureCandidate ?? candidates[candidates.length - 1];
      }
    }

    const date = createTokyoDate(chosenYear, parsed.month, parsed.day);
    const result = {
      ...parsed,
      year: chosenYear,
      date,
      isoDate: formatIsoDate(date),
    };

    previous = result;
    return result;
  });
}

export function parseJapaneseDateLabel(label) {
  const normalized = label
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  const match = normalized.match(/^(\d{1,2})月(\d{1,2})日\s*[（(]\s*([月火水木金土日])\s*[）)]$/);
  if (!match) {
    throw new Error(`日付形式を解析できません: ${label}`);
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const weekdaySymbol = match[3];
  const weekdayIndex = WEEKDAY_INDEX[weekdaySymbol];

  return {
    label: label.trim(),
    month,
    day,
    weekdaySymbol,
    weekdayIndex,
  };
}

export function createTokyoDate(year, month, day) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function todayTokyoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return createTokyoDate(Number(lookup.year), Number(lookup.month), Number(lookup.day));
}

export function formatIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatMonthLabel(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function formatFullDate(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

export function addMonths(date, diff) {
  return new Date(date.getFullYear(), date.getMonth() + diff, 1, 12);
}

export function getCalendarDays(monthDate) {
  const start = getMonthStart(monthDate);
  const firstDayIndex = (start.getDay() + 6) % 7;
  const gridStart = new Date(start.getFullYear(), start.getMonth(), 1 - firstDayIndex, 12);
  const days = [];

  for (let offset = 0; offset < 42; offset += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + offset, 12);
    days.push({
      date,
      isoDate: formatIsoDate(date),
      isCurrentMonth: date.getMonth() === monthDate.getMonth(),
    });
  }

  return days;
}

export function groupByDate(items) {
  return items.reduce((map, item) => {
    const list = map.get(item.isoDate) ?? [];
    list.push(item);
    map.set(item.isoDate, list);
    return map;
  }, new Map());
}

export function uniqueVenues(items) {
  const seen = new Set();
  const venues = [];

  items.forEach((item) => {
    if (!item.venue || seen.has(item.venue)) {
      return;
    }
    seen.add(item.venue);
    venues.push(item.venue);
  });

  return venues;
}

export function venueColor(venue) {
  let hash = 0;
  for (let index = 0; index < venue.length; index += 1) {
    hash = venue.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 48% 56%)`;
}

export function buildTimeLabel(startTime, endTime) {
  if (startTime && endTime) {
    return `${startTime} - ${endTime}`;
  }
  if (startTime) {
    return startTime;
  }
  if (endTime) {
    return endTime;
  }
  return "時間未定";
}

export function compareByDate(a, b) {
  if (a.isoDate < b.isoDate) {
    return -1;
  }
  if (a.isoDate > b.isoDate) {
    return 1;
  }
  return a.startTime.localeCompare(b.startTime, "ja");
}
