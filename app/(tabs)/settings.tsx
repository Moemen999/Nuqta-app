import { useRenderProbe } from '@/lib/perfProbe';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { ONBOARDING_KEY } from '@/components/OnboardingScreen';
import { useAppLock } from '@/context/AppLockContext';
import { useNotifications } from '@/context/NotificationsContext';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { APP_FULL_VERSION } from '@/lib/appInfo';
import { categoriesPhrase, walletsPhrase } from '@/lib/archiving';
import { notificationsStatus } from '@/lib/notificationStatus';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActionSheet } from '@/components/ActionSheet';
import type { ThemePreference } from '@/context/ThemeContext';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useConfirm } from '@/components/ConfirmProvider';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LineIcon, MIRRORED_ICONS, type LineIconName } from '@/components/LineIcon';

/** عشان الجملة تطلع بلغة طبيعية مع كل عدد بدل "1 تعديلات" */
function pendingSentence(n: number) {
  if (n === 1) return 'فيه تعديل واحد لسه بيترفع';
  if (n === 2) return 'فيه تعديلين لسه بيترفعوا';
  return `فيه ${n} تعديلات لسه بترفع`;
}

type SettingsRow = {
  key: string;
  title: string;
  /** سطر الحالة على يسار الصف — بيتحسب كل render من البيانات الحقيقية */
  status?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
};

/** «زي الموبايل» بيمشي مع إعداد الموبايل (فاتح بالنهار وغامق بالليل لو مظبوط كده) */
const THEME_LABEL: Record<ThemePreference, string> = { system: 'زي الموبايل', light: 'فاتح', dark: 'داكن' };

/** أيقونة صغيرة لكل صف (دراسة الشكل خطوة 6) — زينة بس، مخفية عن قارئ الشاشة. بالمفتاح عشان المصفوفة متتلخبطش */
const ROW_ICON: Record<string, LineIconName> = {
  wallets: 'wallet-outline', categories: 'pricetag-outline', archive: 'archive-outline', notifications: 'notifications-outline',
  lock: 'lock-closed-outline', theme: 'contrast-outline', guide: 'book-outline', onboarding: 'hand-left-outline',
  feedback: 'chatbubble-ellipses-outline', about: 'information-circle-outline', logout: 'log-out-outline', deleteAccount: 'trash-outline',
};
type SettingsSection = { key: string; title: string; subtitle?: string; rows: SettingsRow[] };

/**
 * شاشة الإعدادات = قايمة واحدة متعرّفة في مصفوفة واحدة.
 *
 * قبل كده كانت الشاشة دي 600 سطر: إدارة المحافظ والفئات والإشعارات والقفل
 * والثيم والخروج، كلهم مكتوبين بالطول في نفس الـJSX. إضافة صف كانت معناها
 * تدوّر على مكانه وسط كل ده، ونقل قسم معناه قص ولصق مية سطر.
 *
 * دلوقتي الأقسام بيانات، والعرض كومبوننت واحد. نقل صف = تحريك سطر في
 * المصفوفة، وإضافة صف = سطر جديد. والشاشات الجوّه (المحافظ، الفئات،
 * الإشعارات) بقت ملفات لوحدها بنفس منطق الحفظ بالحرف.
 */
export default function SettingsScreen() {
  useRenderProbe('Settings');
  const insets = useSafeAreaInsets();
  const { colors, preference, setTheme } = useTheme();
  const [themeMenu, setThemeMenu] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, logOut } = useAuth();
  const { enabled: lockEnabled } = useAppLock();
  const notifs = useNotifications();
  const { wallets, categories, pendingWrites, deletionPending } = useData();
  const confirm = useConfirm();

  const activeWallets = useMemo(() => wallets.filter(w => !w.archived).length, [wallets]);
  const activeCategories = useMemo(() => categories.filter(c => !c.archived).length, [categories]);

  function replayOnboarding() {
    confirm('شاشة الترحيب', 'هتظهرلك تاني أول ما تفتح التطبيق المرة الجاية.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تمام',
        onPress: async () => {
          try { await AsyncStorage.removeItem(ONBOARDING_KEY); } catch {}
        },
      },
    ]);
  }

  /**
   * التعديلات اللي لسه ما وصلتش للسيرفر بتضيع بعد تسجيل الخروج: فايربيز بتلغي
   * طابور الكتابة لما المستخدم يتغير، والطابور نفسه في الذاكرة بس. فلازم
   * المستخدم يعرف قبل ما يخرج، مش يكتشف إن عمليات ناقصة بعدين.
   */
  function confirmLogout() {
    if (pendingWrites > 0) {
      confirm(
        'لسه فيه بيانات بترفع',
        `${pendingSentence(pendingWrites)}. لو خرجت دلوقتي اللي لسه ما اترفعش ممكن يضيع. استنى شوية لحد ما النت يخلص رفعه، أو اخرج وانت عارف.`,
        [
          { text: 'أستنى', style: 'cancel' },
          { text: 'اخرج برضه', style: 'destructive', onPress: () => logOut() },
        ]
      );
      return;
    }
    confirm('تسجيل الخروج', 'متأكد إنك عايز تخرج من حسابك؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'خروج', style: 'destructive', onPress: () => logOut() },
    ]);
  }

  const sections: SettingsSection[] = useMemo(() => [
    {
      key: 'data',
      title: 'بياناتك',
      rows: [
        {
          key: 'wallets',
          title: 'المحافظ',
          status: walletsPhrase(activeWallets),
          onPress: () => router.push('/settings-screens/wallets'),
        },
        {
          key: 'categories',
          title: 'الفئات',
          status: categoriesPhrase(activeCategories),
          onPress: () => router.push('/settings-screens/categories'),
        },
        {
          key: 'archive',
          title: 'أرشيف العمليات وتصدير إكسيل',
          onPress: () => router.push('/archive'),
        },
      ],
    },
    {
      key: 'app',
      title: 'التطبيق',
      rows: [
        {
          key: 'notifications',
          title: 'الإشعارات',
          status: notificationsStatus({
            enabled: notifs.enabled,
            dailyEnabled: notifs.dailyEnabled,
            dailyHour: notifs.dailyHour,
          }),
          onPress: () => router.push('/settings-screens/notifications'),
        },
        {
          key: 'lock',
          // الصف ده كان بيفتح مودال "تغيير الباسورد" على طول، فإلغاء القفل
          // ووقت الطلب ومهلة السماح بقوا مش موجودين في أي مكان. بقى بيروح
          // لشاشة فيها القسم كامل زي ما كان قبل إعادة التنظيم.
          title: 'قفل التطبيق',
          status: lockEnabled ? 'مفعّل' : 'مش مفعّل',
          onPress: () => router.push('/settings-screens/lock'),
        },
        {
          key: 'theme',
          title: 'الشكل',
          // اختيار من تلاتة في قايمة (مش قلب بدوسة — شكله صف تنقّل وكان بيقلب الثيم من غير ما تسأل)
          status: THEME_LABEL[preference],
          onPress: () => setThemeMenu(true),
        },
      ],
    },
    {
      key: 'help',
      title: 'المساعدة',
      rows: [
        { key: 'guide', title: 'دليل المستخدم', onPress: () => router.push('/user-guide') },
        { key: 'onboarding', title: 'إعادة عرض شاشة الترحيب', onPress: replayOnboarding },
        { key: 'feedback', title: 'شاركنا رأيك', onPress: () => router.push('/settings-screens/feedback') },
        {
          key: 'about',
          title: 'عن التطبيق',
          status: APP_FULL_VERSION,
          onPress: () => router.push('/settings-screens/about'),
        },
      ],
    },
    {
      key: 'account',
      title: 'الحساب',
      subtitle: user?.email ?? undefined,
      rows: [
        { key: 'logout', title: 'تسجيل الخروج', onPress: confirmLogout, tone: 'danger' },
        // جوجل بلاي بتطلب المسار ده ظاهر في إعدادات الحساب (reports/2026-11-03-account-delete-export.md)
        // مسح بدأ ومخلصش ← السطر بيقول كده (التسجيل التلقائي واقف لحد ما يخلص — جولة 2 SHOULD-FIX 1)
        { key: 'deleteAccount', title: 'مسح الحساب', status: deletionPending ? 'ما خلصش — كمّل المسح' : undefined, onPress: () => router.push('/settings-screens/delete-account'), tone: 'danger' },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [activeWallets, activeCategories, notifs.enabled, notifs.dailyEnabled, notifs.dailyHour,
      lockEnabled, preference, user?.email, pendingWrites, deletionPending]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>الإعدادات</Text>

      {sections.map(section => (
        <View key={section.key} testID={`settings_section_${section.key}`} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {!!section.subtitle && <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>}
          <View style={styles.card}>
            {section.rows.map((row, i) => (
              <TouchableOpacity accessibilityRole="button"
                key={row.key}
                testID={`settings_row_${row.key}`}
                style={[styles.row, i > 0 && styles.rowDivider]}
                onPress={row.onPress}>
                <View style={styles.rowLead}>
                  {!!ROW_ICON[row.key] && <LineIcon name={ROW_ICON[row.key]} mirrored={MIRRORED_ICONS.has(ROW_ICON[row.key])} size={20} color={row.tone === 'danger' ? colors.dangerText : colors.textSecondary} />}
                  <Text style={[styles.rowTitle, row.tone === 'danger' && { color: colors.dangerText }]}>
                    {row.title}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  {!!row.status && <Text style={styles.rowStatus}>{row.status}</Text>}
                  {/* RTL: "جوّه" ناحية الشمال — "›" كان بيشاور للاتجاه الغلط */}
                  {row.tone !== 'danger' && <Text style={styles.chevron} accessible={false} importantForAccessibility="no">‹</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
      <ActionSheet visible={themeMenu} testID="theme_menu" title="الشكل" onClose={() => setThemeMenu(false)}
        actions={(['system', 'light', 'dark'] as ThemePreference[]).map(k => ({
          key: k, testID: `theme_option_${k}`,
          label: k === preference ? `${THEME_LABEL[k]} ✓` : THEME_LABEL[k], selected: k === preference,
          onPress: () => setTheme(k),
        }))} />
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxl, paddingBottom: space.huge * 2 },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginBottom: space.xs },
    section: { marginTop: space.huge },
    // عناوين الأقسام أصغر وأهدى (دراسة الشكل) — الصفوف هي المهمة
    sectionTitle: { color: c.textSecondary, fontSize: typeScale.caption, fontWeight: '700', textAlign: 'right', marginBottom: space.xs },
    sectionSubtitle: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.sm },
    card: { backgroundColor: c.surface, borderRadius: radius.xl, overflow: 'hidden' },
    row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xxl, minHeight: MIN_TOUCH + space.md },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    rowLead: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md, flexShrink: 1 },
    rowTitle: { color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right', flexShrink: 1 },
    rowRight: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm },
    rowStatus: { color: c.textSecondary, fontSize: typeScale.caption },
    chevron: { color: c.textSecondary, fontSize: typeScale.title },
  });
}
