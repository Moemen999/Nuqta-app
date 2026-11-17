import { useNotice } from '@/components/NoticeProvider';
import { useConfirm } from '@/components/ConfirmProvider';
import BackButton from '@/components/BackButton';
import { useNotifications } from '@/context/NotificationsContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { timeLabel } from '@/lib/notificationStatus';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { useBusy } from '@/lib/useBusy';
import { BANNER_LABELS, BANNER_TYPES, WARNING_BANNERS, intervalMs, intervalOptions } from '@/lib/bannerDismiss';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { exactAlarmStatus } from '@/lib/exactAlarm';
import { useMemo, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import CountedText from '@/components/CountedText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cardElevation, typeScale, radius, space } from '@/lib/tokens';

export const PERMISSION_DENIED_TITLE = 'الإشعارات مقفولة من الموبايل';
export const PERMISSION_DENIED_BODY = 'التطبيق مش مسموح له يبعت إشعارات. فعّلها من إعدادات الموبايل.';
export const OPEN_SETTINGS_LABEL = 'افتح الإعدادات';

/**
 * السطر ده اترجّع من النسخة القديمة.
 *
 * لما القسم اتنقل لشاشة لوحده، سطر "الإشعارات مفعّلة" اتشال ومحلوش بديل —
 * فبقى مفيش حاجة **جوه الشاشة** بتأكد إن الحالة شغالة. سطر الحالة على صف
 * الإعدادات بيقولها، بس المستخدم اللي جوه الشاشة مش شايفه.
 *
 * (اللي ما اتـرجّعش عن قصد: زرار "🔔 تفعيل الإشعارات" وزرار "إيقاف
 * الإشعارات" الأحمر — الاتنين بقوا مفتاح واحد، والمفتاح أوضح من زرار أحمر
 * شكله حذف لحاجة بترجع بضغطة. و"من غير تذكير يومي" بقت وضع المفتاح.)
 */
export const STATUS_ON = 'الإشعارات مفعّلة';

/** testID بحروف صغيرة وشرطة (testIdConvention): noTxToday ← no_tx_today */
const snake = (s: string) => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
export const STATUS_OFF = 'الإشعارات مقفولة';

export const EXACT_ALARM_TITLE = 'التذكيرات ممكن توصل متأخر';
export const EXACT_ALARM_BODY = 'من غير إذن "المنبهات والتذكيرات" أندرويد ممكن يأخّر التذكير عن معاده. افتح الإعداد، ودوّر على نقطة في القايمة وفعّلها.';
export const EXACT_ALARM_STATUS_UNKNOWN = 'مش قادرين نعرف من جوه التطبيق هو مفعّل ولا لأ. لو لقيت نقطة في القايمة ومفتاحها مفعّل، يبقى تمام.';
export const EXACT_ALARM_BUTTON = 'افتح إعداد المنبهات والتذكيرات';
export const EXACT_ALARM_FAILED_TITLE = 'مقدرناش نفتح الإعداد';
export const EXACT_ALARM_FAILED_BODY = 'دوّر في إعدادات الموبايل على "المنبهات والتذكيرات"، وفعّلها لنقطة.';

/**
 * إعدادات الإشعارات.
 *
 * المفتاح بيعكس الحالة الحقيقية مش نية المستخدم: التفعيل بيطلب إذن النظام،
 * ولو المستخدم رفض المفتاح بيرجع مقفول وبنقوله يفعّلها منين. قبل كده كان
 * زرار "إيقاف الإشعارات" أحمر كأنه حذف — وهو مجرد تبديل بيرجع بضغطة.
 *
 * والإطفاء بيلغي كل التذكيرات المجدولة (`disableNotifications` في الكونتكست
 * بتنادي `cancelAllReminders`)، فمفيش إشعار بيوصل بعد ما يقفلها.
 */
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const notice = useNotice();
  const confirm = useConfirm();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const notifs = useNotifications();
  const banners = useBannerDismiss();
  const { busy: openingAlarm, run: runOpenAlarm } = useBusy();
  const alarmStatus = exactAlarmStatus({ os: Platform.OS, apiLevel: Platform.Version });
  const [showRoutine, setShowRoutine] = useState(false);
  const { busy, run } = useBusy();
  const [showTimeIos, setShowTimeIos] = useState(false);
  const pickerValue = useMemo(() => {
    const d = new Date();
    d.setHours(notifs.dailyHour, notifs.dailyMinute, 0, 0);
    return d;
  }, [notifs.dailyHour, notifs.dailyMinute]);

  function onTimeChange(e: DateTimePickerEvent, picked?: Date) {
    if (Platform.OS !== 'android') setShowTimeIos(false);
    // "إلغاء" في نافذة النظام ← مفيش تغيير
    if (e.type !== 'set' || !picked) return;
    notifs.setDailyTime(picked.getHours(), picked.getMinutes());
  }
  function openTimePicker() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: pickerValue, mode: 'time', is24Hour: false, onChange: onTimeChange });
    } else {
      setShowTimeIos(v => !v);
    }
  }

  function toggle(next: boolean) {
    if (busy) return;
    run(async () => {
      if (!next) { await notifs.disableNotifications(); return; }
      const ok = await notifs.enableNotifications();
      // الإذن اترفض: المفتاح بيفضل مقفول لأن `enabled` ما اتغيرتش أصلاً.
      // وبدل ما نكتب له الطريق في الإعدادات (اللي بيختلف من موبايل للتاني)،
      // بنفتحهاله. وأول ما يرجع، `refreshPermission` في الكونتكست بتعيد
      // الفحص لوحدها فالمفتاح وسطر الحالة بيتحدّثوا من غير ما يعمل حاجة.
      if (!ok) {
        confirm(PERMISSION_DENIED_TITLE, PERMISSION_DENIED_BODY, [
          { text: 'إلغاء', style: 'cancel' },
          { text: OPEN_SETTINGS_LABEL, onPress: () => { Linking.openSettings().catch(() => {}); } },
        ]);
      }
    });
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <BackButton />
        <ScreenTitle>الإشعارات</ScreenTitle>
      </View>

      <View style={styles.switchRow}>
        <Switch
          testID="notifications_switch"
          value={notifs.enabled}
          onValueChange={toggle}
          disabled={busy}
          trackColor={{ false: colors.borderStrong, true: colors.accent }}
          thumbColor={colors.onAccent}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>الإشعارات</Text>
          <Text testID="notifications_status" style={styles.status}>
            {notifs.enabled ? STATUS_ON : STATUS_OFF}
          </Text>
          <Text style={styles.hint}>
            {notifs.enabled
              ? 'هتوصلك تذكيرات قبل مواعيد الاشتراكات وأقساط الجمعية'
              : 'فعّلها عشان توصلك تذكيرات الاشتراكات والجمعية حتى والتطبيق مقفول'}
          </Text>
        </View>
      </View>

      {notifs.enabled && (
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Switch
              testID="notifications_daily_switch"
              value={notifs.dailyEnabled}
              onValueChange={v => notifs.setDailyEnabled(v)}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.onAccent}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>تذكير يومي</Text>
              {/* النص بيتغيّر مع الحالة: قبل كده كان بيقول "تذكير كل يوم"
                  حتى والتذكير مقفول، فوضع المفتاح كان الإشارة الوحيدة */}
              <Text style={styles.hint}>
                {notifs.dailyEnabled
                  ? 'تذكير كل يوم تسجّل مصاريفك'
                  : 'من غير تذكير يومي — فعّله لو عايز واحد'}
              </Text>
            </View>
          </View>

        </View>
      )}

      {/* إذن "المنبهات والتذكيرات" (2026-10-28): من غيره أندرويد 12+ بيأخّر التذكير لحد ساعة.
          الحالة مبتتقريش من التطبيق (lib/exactAlarm.ts) فالكارت ظاهر طول ما الإشعارات شغالة */}
      {notifs.enabled && alarmStatus !== 'not-needed' && (
        <View testID="exact_alarm_card" style={styles.card}>
          <Text style={styles.switchLabel} accessibilityRole="header">{EXACT_ALARM_TITLE}</Text>
          {/* alarmText مش hint (a11y-architect): textMuted 11.5 كان تحت 4.5:1 في الثيمين، والسطرين دول الإرشاد الوحيد */}
          <Text style={styles.alarmText}>{EXACT_ALARM_BODY}</Text>
          <Text testID="exact_alarm_status" style={[styles.alarmText, { marginTop: space.xs }]}>{EXACT_ALARM_STATUS_UNKNOWN}</Text>
          <TouchableOpacity testID="exact_alarm_open" style={styles.alarmBtn} disabled={openingAlarm}
            onPress={() => runOpenAlarm(async () => {
              if (!(await notifs.openExactAlarmSettings())) notice(EXACT_ALARM_FAILED_TITLE, EXACT_ALARM_FAILED_BODY);
            })}
            accessibilityRole="button" accessibilityLabel={EXACT_ALARM_BUTTON} accessibilityHint="بيفتح إعدادات الموبايل"
            accessibilityState={{ busy: openingAlarm, disabled: openingAlarm }}>
            <Text style={styles.alarmBtnText}>{EXACT_ALARM_BUTTON}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* الساعة برّه كارت الإشعارات (2026-10-28): بتتحكم في بانر "لسه ما سجلتش" في الرئيسية
          كمان، فلازم تتظبط حتى والإشعارات مقفولة. أي ساعة من 24 بدل 4 اختيارات */}
      <View style={styles.card}>
        <Text style={styles.switchLabel}>الساعة كام نفكّرك تسجّل مصاريف النهاردة؟</Text>
        <Text style={styles.hint}>
          {`بانر "لسه ما سجلتش مصاريف النهاردة" بيظهر في الرئيسية من ساعة المعاد. ولو التذكير اليومي شغّال، الإشعار بيوصلك في نفس المعاد.`}
        </Text>
        {/* منتقي الوقت بتاع النظام (أي ساعة وأي دقيقة — 9:13، 9:55). أندرويد: نافذة النظام؛ غيره: منتقي جوه الشاشة */}
        <TouchableOpacity testID="notifications_time_button" style={styles.timeBtn}
          onPress={openTimePicker}
          accessibilityRole="button" accessibilityLabel="معاد التذكير"
          accessibilityValue={{ text: timeLabel(notifs.dailyHour, notifs.dailyMinute) }}
          accessibilityHint="بيفتح اختيار الوقت">
          <Text testID="notifications_time_value" style={styles.timeValue}>{timeLabel(notifs.dailyHour, notifs.dailyMinute)}</Text>
        </TouchableOpacity>
        {Platform.OS !== 'android' && showTimeIos && (
          <DateTimePicker value={pickerValue} mode="time" display="spinner" onChange={onTimeChange} />
        )}
      </View>

      {/* مدة رجوع كل بانر بعد الـ✕ (قرار مؤمن 2026-10-28) — على الجهاز ده بس */}
      <View style={styles.card}>
        <Text style={styles.switchLabel}>التنبيه اللي تقفله يرجع بعد قد إيه؟</Text>
        <Text style={styles.hint}>
          لما تقفل تنبيه في الرئيسية بالـ✕، بيرجع بعد المدة دي لو المشكلة لسه موجودة. تحذيرات الأرقام مددها أقصر، عشان رقم ممكن يكون غلط ميتخبّاش وقت طويل.
        </Text>
        {/* مجموعتين (visual-identity-reviewer: 10 صفوف بتطوّل الشاشة): التحذيرات مفتوحة دايمًا،
            والباقي مطوي لحد ما المستخدم يفتحه */}
        <Text style={[styles.groupLabel, { marginTop: space.lg }]}>تحذيرات الأرقام</Text>
        {[...WARNING_BANNERS, ...(showRoutine ? BANNER_TYPES.filter(t => !WARNING_BANNERS.includes(t)) : [])].map((type, i) => {
          const chosen = intervalMs(type, banners.intervals);
          return (
            <View key={type} style={{ marginTop: space.lg }}>
              {i === WARNING_BANNERS.length && <Text style={[styles.groupLabel, { marginBottom: space.xs }]}>باقي التنبيهات</Text>}
              <Text style={styles.typeLabel}>{BANNER_LABELS[type]}</Text>
              <View style={styles.row}>
                {intervalOptions(type).map(o => (
                  <TouchableOpacity key={o.id} testID={`banner_interval_${snake(type)}_${o.id}`}
                    onPress={() => banners.setInterval(type, o.id)}
                    {...selectionA11y(chosen === o.ms, 'radio')}
                    accessibilityLabel={`${BANNER_LABELS[type]}: يرجع بعد ${o.label}`}
                    style={[styles.graceBtn, selectionStyle(colors, chosen === o.ms)]}>
                    <Text style={{ color: colors.text, fontSize: typeScale.caption }}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}
        <TouchableOpacity testID="banner_intervals_toggle" style={styles.toggleRow} onPress={() => setShowRoutine(v => !v)}
          accessibilityRole="button" accessibilityState={{ expanded: showRoutine }}>
          {showRoutine
            ? <Text style={styles.toggleText}>اخفي باقي التنبيهات</Text>
            : <CountedText title="اظهر باقي التنبيهات" count={BANNER_TYPES.length - WARNING_BANNERS.length} style={styles.toggleText} />}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxl, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xl },
    switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.lg },
    switchLabel: { color: c.text, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
    status: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: 2 },
    hint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginTop: 3, lineHeight: 17 },
    card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: space.xl, marginTop: 18, ...cardElevation(c) },
    row: { flexDirection: 'row-reverse', gap: space.sm, marginTop: space.sm },
    graceBtn: { flex: 1, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingVertical: space.sm, minHeight: 44 },
    timeBtn: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
    timeValue: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'center' },
    typeLabel: { color: c.text, fontSize: typeScale.body, textAlign: 'right' },
    alarmText: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right', marginTop: space.xxs, lineHeight: 21 },
    alarmBtn: { minHeight: 44, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: space.md, paddingHorizontal: space.lg },
    alarmBtnText: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700' },
    groupLabel: { color: c.textSecondary, fontSize: typeScale.caption, fontWeight: '700', textAlign: 'right' },
    toggleRow: { minHeight: 44, justifyContent: 'center', marginTop: space.sm },
    toggleText: { color: c.accentText, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
  });
}
