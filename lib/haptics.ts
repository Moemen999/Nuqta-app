import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * اهتزاز خفيف بحساب (بحث «إزاي يبقى فخم» 2026-11-06، اقتراح 6): لما التابة تتغيّر، ونجاح لما تحفظ، وغلط لما الكتابة
 * تفشل — **مش مع كل دوسة**. 3 أنواع بس، ومحدش بيستدعي `expo-haptics` غير من هنا.
 *
 * على أندرويد `performAndroidHapticsAsync` مش `impactAsync`/`notificationAsync`: التوثيق نفسه بيقول إن دول «simulated
 * using Vibrator» و«not recommended»، والتاني اهتزاز النظام (ومن غير صلاحية VIBRATE) — اتأكد في expo-haptics 15.0.8
 * المتثبّتة (SDK 54). الفشل **بيتبلع عن قصد**: الاهتزاز زينة، وجهاز مالوش موتور مبيوقّعش حفظ ولا يطلّع رسالة.
 */
// بياخد دالة مش وعد: رمية متزامنة (موديول native مش موجود) كانت هتطلع برّه — والاهتزاز بيتنادى من جوه رسالة نتيجة
// الفلوس، فرمية هناك كانت هتوقّع التطبيق بعد ما الدفعة اتأكدت (silent-failure-hunter)
function fire(call: () => Promise<void>) {
  try { call().catch(() => undefined); } catch { /* زينة */ }
}

/**
 * أندرويد: النوع لازم يكون موجود في نسخة الموبايل، وإلا الموديول بيرمي `HapticsNotSupportedException`
 * («A haptics engine is not available on this device» — `HapticsRecord.kt`). و**مينفعش نمسكها**: `performAndroidHapticsAsync`
 * في expo-haptics 15.0.8 بينادي الموبايل من غير `return`/`await` (`src/Haptics.ts`)، فالرفض بيطير لوحده ← Sentry
 * «onunhandledrejection» (NUQTA-2، الشاومي أندرويد 12، بناء 1.0.0.008). عشان كده بنختار النوع **قبل** النداء حسب نسخة أندرويد:
 * `Segment_Tick` 14+ (كان على التابات — مكانتش بتهتز على الشاومي)، `Confirm`/`Reject` 11+ (API 30)،
 * و`Clock_Tick`/`Context_Click`/`Long_Press` في كل النسخ. وكلهم بيحترموا إعداد «اهتزاز اللمس» — مقفول = مفيش، وده الصح.
 */
const API = Platform.OS === 'android' ? Number(Platform.Version) : 0;
function android(type: Haptics.AndroidHaptics) {
  fire(() => Haptics.performAndroidHapticsAsync(type));
}

/** دوسة على تابة (مع الضغط — حتى لو هي نفس التابة المفتوحة) */
export function hapticSelect() {
  if (Platform.OS === 'android') android(Haptics.AndroidHaptics.Clock_Tick);
  else if (Platform.OS === 'ios') fire(() => Haptics.selectionAsync());
}

/** الحفظ نجح (المودال قفل) */
export function hapticSuccess() {
  if (Platform.OS === 'android') android(API >= 30 ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Context_Click);
  else if (Platform.OS === 'ios') fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** الكتابة فشلت (مع رسالة «الكتابة ما وصلتش») */
export function hapticError() {
  if (Platform.OS === 'android') android(API >= 30 ? Haptics.AndroidHaptics.Reject : Haptics.AndroidHaptics.Long_Press);
  else if (Platform.OS === 'ios') fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
