import { APP_VERSION } from '@/lib/appInfo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** أنواع الرأي — مفاتيح إنجليزية ثابتة عشان القواعد ماتتعلقش بنص العرض */
export const FEEDBACK_TYPES = ['bug', 'idea', 'praise'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = {
  bug: 'مشكلة',
  idea: 'اقتراح',
  praise: 'رأي',
};

export const FEEDBACK_MAX_LENGTH = 1000;

export const FEEDBACK_PRIVACY_NOTE =
  'هنبعت مع رأيك رقم الإصدار ونوع الموبايل بس، مفيش أي بيانات مالية.';

/**
 * هل الرأي ده ينفع يتبعت؟ النص الفاضي أو المسافات بس مالوش معنى.
 * الطول بيتقاس **بعد** التقليم، عشان يطابق اللي بيتبعت فعلاً.
 */
export function feedbackTextValid(raw: string) {
  const text = raw.trim();
  return text.length > 0 && text.length <= FEEDBACK_MAX_LENGTH;
}

/** العداد بيعدّ المكتوب زي ما هو — المستخدم بيشوف اللي كتبه مش اللي هيتبعت */
export function feedbackRemaining(raw: string) {
  return FEEDBACK_MAX_LENGTH - raw.length;
}

/**
 * معلومات الجهاز اللي بتتبعت مع الرأي.
 *
 * كلها من مكتبات موجودة أصلاً — من غير أي موديول أصلي جديد. `deviceModel`
 * هنا **نسخة نظام التشغيل** مش موديل الهاردوير: الموديل الحقيقي محتاج
 * `expo-device` وده موديول أصلي جديد.
 *
 * ومقصود إننا **مش** بناخد `Constants.deviceName`: على آيفون بيبقى الاسم
 * اللي المستخدم سمّى بيه جهازه، وده غالبًا فيه اسمه الشخصي — وإحنا قايلين
 * له إننا بنبعت نوع الموبايل بس.
 */
export function deviceInfo() {
  return {
    appVersion: APP_VERSION,
    platform: String(Platform.OS),
    deviceModel: String(Platform.Version ?? ''),
  };
}

/** بيقلّم النص ويبني المستند اللي هيتبعت — من غير createdAt (بييجي من السيرفر) */
export function buildFeedbackDoc(uid: string, type: FeedbackType, rawText: string) {
  return {
    uid,
    type,
    text: rawText.trim(),
    ...deviceInfo(),
  };
}

export const FEEDBACK_SENT = 'وصلنا رأيك، شكرًا ليك';
export const FEEDBACK_PENDING = 'هيتبعت أول ما النت يرجع';
export const FEEDBACK_FAILED = 'مقدرناش نبعته دلوقتي، جرب كمان شوية';
