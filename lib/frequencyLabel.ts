/**
 * اسم تكرار الاشتراك زي ما بيتقال (قاعدة 1، خط النهاية: "مخصص" في تكرار الاشتراك).
 *
 * "مخصص" كانت فصحى ومبتقولش حاجة: الكارت كان بيقول "الكاش · مخصص" والرقم نفسه مستخبي.
 * دلوقتي الكارت بيقول "كل 45 يوم" — بالعدد صح بالعامية: يوم / يومين / 3–10 أيام / 11+ يوم.
 */
export type Frequency = 'monthly' | 'yearly' | 'custom';

export function everyDaysLabel(days: number): string {
  if (!Number.isFinite(days) || days < 1 || !Number.isInteger(days)) return 'كل كام يوم';
  if (days === 1) return 'كل يوم';
  if (days === 2) return 'كل يومين';
  if (days <= 10) return `كل ${days} أيام`;
  return `كل ${days} يوم`;
}

export function frequencyLabel(frequency: Frequency | string, customDays?: number): string {
  if (frequency === 'monthly') return 'شهري';
  if (frequency === 'yearly') return 'سنوي';
  return everyDaysLabel(customDays ?? NaN);
}

/** اسم زرار الاختيار في الفورم — نفس كلمة الدليل (`user-guide.tsx`: "شهري، سنوي، أو كل كام يوم"). والخانة تحته "عدد الأيام" */
export const CUSTOM_FREQUENCY_BUTTON = 'كل كام يوم';
export const CUSTOM_DAYS_FIELD = 'عدد الأيام';
