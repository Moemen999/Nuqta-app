import { AccessibilityInfo } from 'react-native';

/**
 * إعلان نتيجة بعد ما الشاشة/الورقة تتقفل (الميزة 8 — الجولة 2، بند 8): الإعلان وقت الرجوع كان بيتقطع لما قارئ الشاشة
 * ينقل التركيز للشاشة اللي ورا. التأخير بسيط وبيعدّي اللي بيتشال (التايمر برّه الكومبوننت). زينة: أي خطأ بيتبلع
 */
export const ANNOUNCE_AFTER_LEAVE_MS = 700;
export function announceAfterLeave(text: string): void {
  setTimeout(() => {
    try { AccessibilityInfo.announceForAccessibility(text); } catch { /* زينة */ }
  }, ANNOUNCE_AFTER_LEAVE_MS);
}
