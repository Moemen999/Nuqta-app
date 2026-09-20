import Constants from 'expo-constants';

/** رقم إصدار التطبيق من app.json */
export const APP_VERSION = Constants.expoConfig?.version ?? '—';

/**
 * رقم البناء اللي `app.config.js` حطه وقت البناء (run_number ناقص الإزاحة،
 * بصفر على الشمال لتلات خانات). على جهاز مطوّر بيبقى 'dev'.
 */
export const BUILD_NUMBER = String(Constants.expoConfig?.extra?.buildNumber ?? 'dev');

/**
 * "1.0.0.000" — الإصدار والبناء في رقم واحد.
 *
 * منفصلة عن الواجهة عشان نفس النص بالظبط يروح لشاشة "عن التطبيق" ومع الرأي:
 * لو المستخدم قال "عندي مشكلة في 1.0.0.007" لازم نلاقي نفس الرقم في المستند.
 */
export function fullVersionLabel(version = APP_VERSION, build = BUILD_NUMBER) {
  return `${version}.${build}`;
}

export const APP_FULL_VERSION = fullVersionLabel();
