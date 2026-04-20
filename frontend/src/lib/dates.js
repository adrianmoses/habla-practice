// All date math for the dashboard runs in Europe/Madrid so "today" and the
// weekly grid match the backend's view regardless of where the browser is.

const MADRID_TZ = "Europe/Madrid";

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: MADRID_TZ,
  weekday: "short",
});
const YMD_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: MADRID_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WEEKDAY_TO_INDEX = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const SPANISH_MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

export function madridWeekdayIndex(date) {
  return WEEKDAY_TO_INDEX[WEEKDAY_FMT.format(date)] ?? 0;
}

// Returns "YYYY-MM-DD" in Madrid local time — usable as a stable day key.
function madridYmd(date) {
  return YMD_FMT.format(date);
}

function madridDayDiff(a, b) {
  const [ay, am, ad] = madridYmd(a).split("-").map(Number);
  const [by, bm, bd] = madridYmd(b).split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((aUtc - bUtc) / 86_400_000);
}

export function relativeDate(iso) {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const diff = madridDayDiff(new Date(), then);
  if (diff === 0) return "hoy";
  if (diff === 1) return "ayer";
  if (diff > 1 && diff < 7) return `hace ${diff} días`;
  const [, m, d] = madridYmd(then).split("-").map(Number);
  return `${d} ${SPANISH_MONTHS[m - 1]}`;
}
