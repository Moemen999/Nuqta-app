import { Tajawal_400Regular } from '@expo-google-fonts/tajawal/400Regular';
import { Tajawal_500Medium } from '@expo-google-fonts/tajawal/500Medium';
import { Tajawal_700Bold } from '@expo-google-fonts/tajawal/700Bold';
import { APP_FONT } from '@/lib/appFont';

/**
 * اللي بيتبعت لـ`useFonts` — مفاتيحه هي `APP_FONT` نفسها، فالاسم اللي الغلاف
 * بيطلبه هو بالظبط الاسم اللي اتحمّل. منفصل عن `appFont.ts` عشان ملفات الخط
 * متتحمّلش مع كل شاشة بتستورد الغلاف.
 *
 * من مسار كل وزن لوحده مش من جذر الحزمة: الجذر بيجيب `useFonts` بتاعها ومعاه
 * `expo-font` كله، واحنا بنستخدم `useFonts` من `expo-font` مباشرة.
 */
export const APP_FONT_SOURCES = {
  [APP_FONT.regular]: Tajawal_400Regular,
  [APP_FONT.medium]: Tajawal_500Medium,
  [APP_FONT.bold]: Tajawal_700Bold,
};
