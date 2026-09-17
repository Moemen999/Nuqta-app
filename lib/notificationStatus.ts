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

export function notificationsStatus(opts: {
  enabled: boolean;
  dailyEnabled: boolean;
  dailyHour: number;
}) {
  if (!opts.enabled) return 'مقفولة';
  if (opts.dailyEnabled) return `تذكير يومي ${hourLabel(opts.dailyHour)}`;
  return 'مفعّلة';
}
