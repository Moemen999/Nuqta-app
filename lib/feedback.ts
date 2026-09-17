import { APP_VERSION } from '@/lib/appInfo';
import * as Device from 'expo-device';
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

/** لما الجهاز مش راضي يقول موديله — بنقول كده صريح مش بنسيب الخانة فاضية */
export const UNKNOWN_DEVICE = 'غير معروف';

/**
 * "Samsung SM-A546B" من الشركة + الموديل.
 *
 * لو الموديل بادئ بنفس اسم الشركة (زي manufacturer: "Google" و
 * modelName: "Google Pixel") مبنكررش الاسم.
 */
export function formatDeviceModel(manufacturer: string | null, modelName: string | null) {
  const make = (manufacturer || '').trim();
  const model = (modelName || '').trim();
  if (make && model) {
    return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
  }
  return make || model || UNKNOWN_DEVICE;
}

/**
 * معلومات الجهاز اللي بتتبعت مع الرأي: نوع الموبايل ونظامه ورقم إصدار
 * التطبيق. مفيش أي حاجة تانية.
 *
 * **ممنوع نقرا `Device.deviceName` ولا `Constants.deviceName` هنا ولا في أي
 * مكان.** ده الاسم اللي المستخدم سمّى بيه جهازه، والمثال في توثيق expo-device
 * نفسه هو "Vivian's iPhone XS" — يعني اسم شخص. وإحنا قايلين للمستخدم إننا
 * بنبعت نوع الموبايل بس، فقراية الحقل ده تخلي الجملة دي كدب. فيه اختبار
 * بيتأكد إن الاسم مش بيوصل للمستند حتى لو الجهاز راجعه.
 */
export function deviceInfo() {
  return {
    appVersion: APP_VERSION,
    platform: String(Platform.OS),
    deviceModel: formatDeviceModel(Device.manufacturer, Device.modelName),
    osVersion: (Device.osVersion || '').trim() || UNKNOWN_DEVICE,
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
