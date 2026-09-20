import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { APP_FULL_VERSION, APP_VERSION, BUILD_NUMBER } from '@/lib/appInfo';
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentryScrub';

/**
 * الـDSN **مش** في الريبو.
 *
 * بييجي من `EXPO_PUBLIC_SENTRY_DSN` وقت البناء (`app.config.js` بيحطه في
 * `extra`). ولو مش موجود، Sentry **مبتشتغلش خالص** — التطبيق بيكمّل عادي.
 * ده مقصود: بناء محلي على جهاز مطوّر، أو أي fork، مبيبعتش أخطاء لمشروع
 * مش بتاعه، ومحدش مضطر يحط DSN عشان يشغّل التطبيق.
 */
export const SENTRY_DSN: string | undefined =
  (Constants.expoConfig?.extra?.sentryDsn as string | undefined) || undefined;

export const sentryEnabled = !!SENTRY_DSN;

/**
 * اسم الإصدار في Sentry = نفس الرقم اللي المستخدم شايفه في "عن التطبيق"
 * وبيتبعت مع الرأي: "1.0.0.007".
 *
 * ده مش تفصيلة شكلية. المستخدم بيقول "المشكلة عندي في 1.0.0.007"، والرأي
 * بيوصل بنفس النص، ولازم نلاقي **نفس** السطر في Sentry من غير ترجمة بين
 * تلات أنظمة ترقيم. و`dist` هو رقم البناء لوحده عشان Sentry تفرّق بين
 * بناءين لنفس الإصدار.
 */
export const SENTRY_RELEASE = APP_FULL_VERSION;
export const SENTRY_DIST = BUILD_NUMBER;

export function initSentry() {
  if (!sentryEnabled) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    release: SENTRY_RELEASE,
    dist: SENTRY_DIST,
    // مفيش بيانات شخصية تلقائية: من غير ده Sentry بتضيف الإيميل والـIP لوحدها
    sendDefaultPii: false,
    // مفيش تتبّع أداء: بياخد عيّنات من الشاشات والطلبات، وده بيزوّد سطح
    // التسريب من غير ما يحل مشكلة عندنا دلوقتي
    tracesSampleRate: 0,
    // الشاشة مليانة أرقام المستخدم — لقطة الشاشة أو شجرة العناصر معناها
    // نبعت أرصدته بالظبط. الاتنين مقفولين.
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: event => scrubEvent(event as any) as any,
    beforeBreadcrumb: crumb => scrubBreadcrumb(crumb as any) as any,
  });

  // تاجات مفيدة للفرز ومفيهاش ولا رقم من فلوس المستخدم
  Sentry.setTag('app_version', APP_VERSION);
  Sentry.setTag('build', BUILD_NUMBER);
}
