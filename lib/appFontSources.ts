import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
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
  [APP_FONT.regular]: IBMPlexSansArabic_400Regular,
  [APP_FONT.medium]: IBMPlexSansArabic_500Medium,
  [APP_FONT.bold]: IBMPlexSansArabic_700Bold,
};
