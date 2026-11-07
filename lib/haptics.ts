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
function fire(p: Promise<void>) {
  p.catch(() => undefined);
}

/** تغيير تابة أو اختيار */
export function hapticSelect() {
  if (Platform.OS === 'android') fire(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick));
  else if (Platform.OS === 'ios') fire(Haptics.selectionAsync());
}

/** الحفظ نجح (المودال قفل) */
export function hapticSuccess() {
  if (Platform.OS === 'android') fire(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm));
  else if (Platform.OS === 'ios') fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** الكتابة فشلت (مع رسالة «الكتابة ما وصلتش») */
export function hapticError() {
  if (Platform.OS === 'android') fire(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject));
  else if (Platform.OS === 'ios') fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
