// Reports use Nigerian (WAT, UTC+1, no daylight saving) calendar days.
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

const lagosToday = () => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10);

// from/to are "YYYY-MM-DD" in Lagos time, inclusive. Defaults to today.
exports.lagosRange = (from, to) => {
  const f = from || to || lagosToday();
  const t = to || from || lagosToday();
  if (!dayRe.test(f) || !dayRe.test(t)) return null;
  const start = new Date(`${f}T00:00:00.000+01:00`);
  const end = new Date(`${t}T23:59:59.999+01:00`);
  if (isNaN(start) || isNaN(end) || start > end) return null;
  if (end - start > 366 * 24 * 3600 * 1000) return null; // keep queries bounded
  return { start, end, from: f, to: t };
};
exports.lagosToday = lagosToday;
