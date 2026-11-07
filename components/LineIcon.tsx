import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

export type LineIconName = ComponentProps<typeof Ionicons>['name'];

/**
 * أيقونات الواجهة — مجموعة واحدة بخط واحد (قرار مؤمن 2026-11-07: «الأيقونات في الواجهة بس»؛ بحث «فخم» اقتراح 12).
 * Ionicons عشان فيها نسخة خطية (`-outline`) ومليانة لكل أيقونة: التابة المختارة مليانة والباقي خطي، زي أبل.
 * **أيقونة الفئة مش هنا** — دي إيموجي اختاره المستخدم ومتخزّن في فايربيز (`CATEGORY_ICONS`).
 * زينة: مخفية عن قارئ الشاشة دايمًا — الاسم بييجي من النص أو `accessibilityLabel` بتاع الزرار اللي حواليها.
 */
export function LineIcon({ name, size = 20, color }: { name: LineIconName; size?: number; color: string }) {
  return <Ionicons name={name} size={size} color={color} accessible={false} importantForAccessibility="no" />;
}
