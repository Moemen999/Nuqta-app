import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';

/**
 * الـsplash بيفضل ظاهر لحد ما التطبيق يبقى عنده حاجة يعرضها — بدل ما يختفي
 * في أول frame ويسيب شاشة فاضية (reports/2026-09-27-splash-diagnosis.md).
 *
 * **الحزام:** بعد SPLASH_SAFETY_MS بيختفي مهما حصل. المؤقّت بيبدأ مع
 * `holdSplash()` في مستوى الموديول — مش جوه كومبوننت — لأن أي كومبوننت ممكن
 * ميتركّبش أصلاً (الخطوط بتعلّق مثلاً)، ووقتها التطبيق يفضل واقف على اللوجو
 * للأبد. ده أوحش من الفراغ اللي بنصلّحه.
 *
 * والحاجتين اللي مايتبلعوش بيروحوا Sentry كرسالة (مفيهاش أي بيانات مستخدم):
 * الحزام اشتغل قبل ما التطبيق يجهز (حاجة فوق علّقت)، و`hideAsync` فشل كل
 * المحاولات. `console.warn` لوحده مش كفاية — Sentry بتشيل breadcrumbs الـconsole.
 */
export const SPLASH_SAFETY_MS = 5000;
export const SPLASH_RETRY_MS = 1000;
export const SPLASH_MAX_ATTEMPTS = 3;

let released = false;
let attempts = 0;
/** التطبيق جهز مرة — بعدها الحزام مش "علّق قبل الجاهزية" حتى لو hideAsync لسه بيعيد */
let readySeen = false;

export function releaseSplash(reason: 'ready' | 'timeout' = 'ready') {
  if (reason === 'ready') readySeen = true;
  if (released) return;
  released = true;
  if (reason === 'timeout' && !readySeen) {
    Sentry.captureMessage('splash: safety timeout fired before the app was ready', 'warning');
  }
  attempts += 1;
  SplashScreen.hideAsync().catch(e => {
    console.warn('[splash] hideAsync', e);
    if (attempts < SPLASH_MAX_ATTEMPTS) {
      released = false;
      setTimeout(() => releaseSplash('ready'), SPLASH_RETRY_MS);
    } else {
      // وقفنا: `released` يفضل true عشان الحزام (5 ثواني) مايدخلش بعدها
      // ويبعت "الحزام اشتغل قبل الجاهزية" غلط ومحاولة رابعة
      Sentry.captureMessage('splash: hideAsync failed on every attempt', 'error');
    }
  });
}

export function holdSplash() {
  SplashScreen.preventAutoHideAsync().catch(e => console.warn('[splash] preventAutoHideAsync', e));
  setTimeout(() => releaseSplash('timeout'), SPLASH_SAFETY_MS);
}
