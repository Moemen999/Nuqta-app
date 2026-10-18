import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

/**
 * أسامي ملفات الخط — المصدر الوحيد. الغلاف (`components/AppText.tsx`) بيختار منها،
 * و`useFonts` في `app/_layout.tsx` بيحمّل بنفس الأسامي (`APP_FONT_SOURCES`) —
 * فمفيش اسم يتكتب في مكان ومايتحمّلش في التاني (أندرويد بيرجع لخط النظام ساكت).
 */
export const APP_FONT = {
  regular: 'Tajawal_400Regular',
  medium: 'Tajawal_500Medium',
  bold: 'Tajawal_700Bold',
} as const;

export type AppFontFamily = (typeof APP_FONT)[keyof typeof APP_FONT];

/** الوزن ← ملف الخط: 700 وفوق ← عريض، 500/600 ← متوسط، غير كده ← عادي */
export function appFontFamily(fontWeight: TextStyle['fontWeight']): AppFontFamily {
  const w = String(fontWeight ?? '');
  if (w === 'bold' || w === '700' || w === '800' || w === '900') return APP_FONT.bold;
  if (w === '500' || w === '600') return APP_FONT.medium;
  return APP_FONT.regular;
}

/**
 * الخطوط اتحمّلت ولا لأ — `app/_layout.tsx` بيحددها قبل ما أي شاشة تترسم
 * (التطبيق مبيترسمش غير بعد ما `useFonts` يخلص أو يفشل).
 *
 * لو فشلت: الأسامي مش متسجّلة، وطلبها هيرسم بخط النظام **ومن غير وزن** (احنا
 * شايلين `fontWeight`) — كل نص عريض في التطبيق كان هيبقى عادي من غير ما حد
 * يعرف. فالغلاف وقتها بيسيب الاستايل زي ما هو: خط النظام بأوزانه، عن قصد.
 */
let appFontReady = false;

export function setAppFontReady(ready: boolean) {
  appFontReady = ready;
}

/**
 * الاستايل اللي بيوصل للنص فعلاً: ملف الخط حسب الوزن، و**من غير `fontWeight`**.
 *
 * `expo-font` بيسجّل كل ملف على إنه "عادي" بس، ولو النص فيه `fontWeight` 700
 * أندرويد بيدوّر على نسخة "عريضة" من الاسم ده، مبيلاقيش، وبيرسم بخط النظام من
 * غير أي خطأ (`ReactFontManager.kt` ← `Typeface.create(fontFamilyName, style)`).
 * الملف نفسه عريض أصلاً، فشيل الوزن مبيضيّعش حاجة.
 *
 * **النص جوه نص:** الجوّاني من غير وزن بياخد وزن اللي بره (`inheritedWeight`) —
 * أندرويد كان هيورّثه لوحده، بس احنا شايلين الوزن وحاطين ملف، فالملف لازم
 * يتحسب من الوزن الموروث. `<Text style={{fontWeight:'700'}}>المتبقي: <Money/></Text>`
 * — `Money` نص جوّه، ومن غير كده المبلغ كان هيطلع عادي جوه سطر عريض.
 * الغلاف (`components/AppText.tsx`) بيعدّي الوزن ده للجوّه.
 *
 * لو الاستايل فيه `fontFamily` صريح بيتساب زي ما هو بوزنه — ده خط تاني مش بتاعنا
 * (والجرد بيرفض `fontFamily` برّه الملف ده).
 */
export function resolveAppFont(
  style: StyleProp<TextStyle>,
  inheritedWeight?: TextStyle['fontWeight'],
): { style: TextStyle; weight: TextStyle['fontWeight'] } {
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  const weight = flat.fontWeight ?? inheritedWeight;
  if (!appFontReady || flat.fontFamily) return { style: flat, weight };
  const { fontWeight: _dropped, ...rest } = flat;
  return { style: { fontFamily: appFontFamily(weight), ...rest }, weight };
}

export function withAppFont(style: StyleProp<TextStyle>): TextStyle {
  return resolveAppFont(style).style;
}

/**
 * اسم التاب: react-navigation بيرسم النص بنفسه (مش من الغلاف)، وعلى أندرويد
 * بيحط `sans-serif-medium` — فالخط بيتحدد هنا وبيتبعت في `tabBarLabelStyle`.
 * دالة مش ثابت: لازم تتحسب بعد ما الخطوط تتحمّل.
 */
export function tabLabelStyle(): TextStyle {
  return withAppFont({ fontSize: 10, fontWeight: '500' });
}
