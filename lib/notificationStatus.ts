/**
 * وصف حالة الإشعارات في سطر واحد — بيتعرض في صف الإعدادات الرئيسي وفي
 * الشاشة نفسها، فلازم يبقى نفس الكلام في الاتنين.
 *
 * منفصل عن الواجهة عشان يتختبر، ولأن الصيغة (12 ساعة بـص/م) بتتكرر.
 */
export function hourLabel(h: number) {
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour} ${h >= 12 ? 'م' : 'ص'}`;
}

/**
 * الوقت بالدقيقة (12 ساعة بـص/م): «9:13 م». الدقيقة 0 ← «9 م» زي `hourLabel`
 * (مفيش «:00» بتتقري زيادة في سطر الحالة).
 */
export function timeLabel(h: number, m = 0) {
  if (!m) return hourLabel(h);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h >= 12 ? 'م' : 'ص'}`;
}

export function notificationsStatus(opts: {
  enabled: boolean;
  dailyEnabled: boolean;
  dailyHour: number;
  dailyMinute?: number;
}) {
  if (!opts.enabled) return 'مقفولة';
  if (opts.dailyEnabled) return `تذكير يومي ${timeLabel(opts.dailyHour, opts.dailyMinute ?? 0)}`;
  return 'مفعّلة';
}

/**
 * «امتى» بالعربي بتوافق العدد: 0 ← النهاردة، 1 ← بكرة، 2 ← بعد يومين،
 * 3–10 ← بعد N أيام (جمع)، 11+ ← بعد N يوم (مفرد منصوب). أي سالب أو كسر بيتقرّب
 * لأقرب يوم صحيح ≥ 0.
 */
export function whenPhrase(days: number) {
  const n = Number.isFinite(days) ? Math.max(0, Math.round(days)) : 0;
  if (n === 0) return 'النهاردة';
  if (n === 1) return 'بكرة';
  if (n === 2) return 'بعد يومين';
  if (n <= 10) return `بعد ${n} أيام`;
  return `بعد ${n} يوم`;
}

/** «كام مرة متأخرة»: 1 ← مرة، 2 ← مرتين متأخرين، 3–10 ← N مرات متأخرة، 11+ ← N مرة متأخرة */
export function overdueCountPhrase(n: number) {
  if (n === 1) return 'مرة متأخرة';
  if (n === 2) return 'مرتين متأخرين';
  if (n <= 10) return `${n} مرات متأخرة`;
  return `${n} مرة متأخرة`;
}

/** «متأخر كام يوم»: 1 ← يوم، 2 ← يومين، 3–10 ← N أيام، 11+ ← N يوم */
export function overdueDaysPhrase(d: number) {
  if (d === 1) return 'متأخر يوم';
  if (d === 2) return 'متأخر يومين';
  if (d <= 10) return `متأخر ${d} أيام`;
  return `متأخر ${d} يوم`;
}
