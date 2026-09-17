import SetLockModal from '@/components/SetLockModal';
import { ONBOARDING_KEY } from '@/components/OnboardingScreen';
import { useAppLock } from '@/context/AppLockContext';
import { useNotifications } from '@/context/NotificationsContext';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { APP_VERSION } from '@/lib/appInfo';
import { categoriesPhrase, walletsPhrase } from '@/lib/archiving';
import { notificationsStatus } from '@/lib/notificationStatus';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const insets = useSafeAreaInsets();
  const { colors, theme, setTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, logOut } = useAuth();
  const { enabled: lockEnabled } = useAppLock();
  const notifs = useNotifications();
  const { wallets, categories, pendingWrites } = useData();
  const [lockModalMode, setLockModalMode] = useState<'enable' | 'change' | 'disable' | null>(null);

  const activeWallets = useMemo(() => wallets.filter(w => !w.archived).length, [wallets]);
  const activeCategories = useMemo(() => categories.filter(c => !c.archived).length, [categories]);

  function replayOnboarding() {
    Alert.alert('شاشة الترحيب', 'هتظهرلك تاني أول ما تفتح التطبيق المرة الجاية.', [
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
      Alert.alert(
        'لسه فيه بيانات بترفع',
        `${pendingSentence(pendingWrites)}. لو خرجت دلوقتي اللي لسه ما اترفعش ممكن يضيع. استنى شوية لحد ما النت يخلص رفعه، أو اخرج وانت عارف.`,
        [
          { text: 'أستنى', style: 'cancel' },
          { text: 'اخرج برضه', style: 'destructive', onPress: () => logOut() },
        ]
      );
      return;
    }
    Alert.alert('تسجيل الخروج', 'متأكد إنك عايز تخرج من حسابك؟', [
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
          title: 'قفل التطبيق',
          status: lockEnabled ? 'مفعّل' : 'مش مفعّل',
          onPress: () => setLockModalMode(lockEnabled ? 'change' : 'enable'),
        },
        {
          key: 'theme',
          title: 'الشكل',
          status: theme === 'dark' ? 'داكن' : 'فاتح',
          onPress: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
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
          status: APP_VERSION,
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
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [activeWallets, activeCategories, notifs.enabled, notifs.dailyEnabled, notifs.dailyHour,
      lockEnabled, theme, user?.email, pendingWrites]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>الإعدادات</Text>

      {sections.map(section => (
        <View key={section.key} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {!!section.subtitle && <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>}
          <View style={styles.card}>
            {section.rows.map((row, i) => (
              <TouchableOpacity
                key={row.key}
                style={[styles.row, i > 0 && styles.rowDivider]}
                onPress={row.onPress}>
                <Text style={[styles.rowTitle, row.tone === 'danger' && { color: colors.danger }]}>
                  {row.title}
                </Text>
                <View style={styles.rowRight}>
                  {!!row.status && <Text style={styles.rowStatus}>{row.status}</Text>}
                  {row.tone !== 'danger' && <Text style={styles.chevron}>›</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {lockModalMode && (
        <SetLockModal visible={!!lockModalMode} mode={lockModalMode} onClose={() => setLockModalMode(null)} />
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right', marginBottom: 6 },
    section: { marginTop: 18 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginBottom: 4 },
    sectionSubtitle: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginBottom: 8 },
    card: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
    row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 14 },
    rowDivider: { borderTopWidth: 1, borderTopColor: c.border },
    rowTitle: { color: c.text, fontSize: 14, fontWeight: '500', textAlign: 'right', flexShrink: 1 },
    rowRight: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
    rowStatus: { color: c.textSecondary, fontSize: 12.5 },
    chevron: { color: c.textMuted, fontSize: 16 },
  });
}
