import BackButton from '@/components/BackButton';
import { useNotifications } from '@/context/NotificationsContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { hourLabel } from '@/lib/notificationStatus';
import { selectionStyle } from '@/lib/selection';
import { useBusy } from '@/lib/useBusy';
import { BANNER_LABELS, BANNER_TYPES, intervalMs, intervalOptions } from '@/lib/bannerDismiss';
import { useBannerDismiss } from '@/lib/useBannerDismiss';
import { useMemo } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const notifs = useNotifications();
  const banners = useBannerDismiss();
  const { busy, run } = useBusy();

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
        Alert.alert(PERMISSION_DENIED_TITLE, PERMISSION_DENIED_BODY, [
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
        <Text style={styles.title}>الإشعارات</Text>
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

      {/* الساعة برّه كارت الإشعارات (2026-10-28): بتتحكم في بانر "لسه ما سجلتش" في الرئيسية
          كمان، فلازم تتظبط حتى والإشعارات مقفولة. أي ساعة من 24 بدل 4 اختيارات */}
      <View style={styles.card}>
        <Text style={styles.switchLabel}>الساعة كام نفكّرك تسجّل مصاريف النهاردة؟</Text>
        <Text style={styles.hint}>
          {`بانر "لسه ما سجلتش" في الرئيسية بيظهر من الساعة دي، ولو التذكير اليومي مفعّل الإشعار بيوصلك في نفس المعاد.`}
        </Text>
        <View style={[styles.row, { alignItems: 'center' }]}>
          <TouchableOpacity testID="notifications_hour_later" style={styles.stepBtn}
            onPress={() => notifs.setDailyHour((notifs.dailyHour + 1) % 24)}
            accessibilityRole="button" accessibilityLabel="ساعة بعد">
            <Text style={styles.stepText}>+</Text>
          </TouchableOpacity>
          <Text testID="notifications_hour_value" style={styles.hourValue}
            accessibilityRole="adjustable" accessibilityLabel={`ساعة التذكير ${hourLabel(notifs.dailyHour)}`}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={e => notifs.setDailyHour((notifs.dailyHour + (e.nativeEvent.actionName === 'increment' ? 1 : 23)) % 24)}>
            {hourLabel(notifs.dailyHour)}
          </Text>
          <TouchableOpacity testID="notifications_hour_earlier" style={styles.stepBtn}
            onPress={() => notifs.setDailyHour((notifs.dailyHour + 23) % 24)}
            accessibilityRole="button" accessibilityLabel="ساعة قبل">
            <Text style={styles.stepText}>−</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* مدة رجوع كل بانر بعد الـ✕ (قرار مؤمن 2026-10-28) — على الجهاز ده بس */}
      <View style={styles.card}>
        <Text style={styles.switchLabel}>التنبيه اللي تقفله يرجع بعد قد إيه؟</Text>
        <Text style={styles.hint}>
          لما تقفل تنبيه في الرئيسية بالـ✕، بيرجع بعد المدة دي لو لسه فيه حاجة. تحذيرات الأرقام مددها أقصر عشان رقم غلط ميفضلش من غير تنبيه كتير.
        </Text>
        {BANNER_TYPES.map(type => {
          const chosen = intervalMs(type, banners.intervals);
          return (
            <View key={type} style={{ marginTop: 12 }}>
              <Text style={styles.typeLabel}>{BANNER_LABELS[type]}</Text>
              <View style={styles.row}>
                {intervalOptions(type).map(o => (
                  <TouchableOpacity key={o.id} testID={`banner_interval_${snake(type)}_${o.id}`}
                    onPress={() => banners.setInterval(type, o.id)}
                    accessibilityRole="button" accessibilityState={{ selected: chosen === o.ms }}
                    accessibilityLabel={`${BANNER_LABELS[type]}: يرجع بعد ${o.label}`}
                    style={[styles.graceBtn, selectionStyle(colors, chosen === o.ms)]}>
                    <Text style={{ color: colors.text, fontSize: 11.5 }}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    switchRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
    switchLabel: { color: c.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
    status: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 2 },
    hint: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 3, lineHeight: 17 },
    card: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginTop: 18, borderWidth: 1, borderColor: c.border },
    row: { flexDirection: 'row-reverse', gap: 8, marginTop: 8 },
    graceBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, minHeight: 44 },
    stepBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
    stepText: { color: c.text, fontSize: 20, fontWeight: '700' },
    hourValue: { flex: 1, color: c.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
    typeLabel: { color: c.text, fontSize: 13, textAlign: 'right' },
  });
}
