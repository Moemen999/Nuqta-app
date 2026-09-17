import ArchiveSheet, { type ReassignItem, type ReassignTarget } from '@/components/ArchiveSheet';
import SetLockModal from '@/components/SetLockModal';
import { ONBOARDING_KEY } from '@/components/OnboardingScreen';
import { useAppLock } from '@/context/AppLockContext';
import { useNotifications } from '@/context/NotificationsContext';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import {
  categoryArchiveBlock, categoryDeleteConsequences, categoryHasHistory, categoryLinkSummary,
  categoryReferences, roundedWalletBalance, walletArchiveBlock, walletDeleteConsequences,
  walletHasHistory, walletLinkSummary, walletReferences, type ArchiveBlock,
} from '@/lib/archiving';
import { fmt } from '@/lib/finance';
import { selectionStyle } from '@/lib/selection';
import { useAmountDrafts } from '@/lib/useAmountDrafts';
import { useBusy, useBusyKey } from '@/lib/useBusy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** عشان الجملة تطلع بلغة طبيعية مع كل عدد بدل "1 تعديلات" */
function pendingSentence(n: number) {
  if (n === 1) return 'فيه تعديل واحد لسه بيترفع';
  if (n === 2) return 'فيه تعديلين لسه بيترفعوا';
  return `فيه ${n} تعديلات لسه بترفع`;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, theme, setTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, logOut } = useAuth();
  const { enabled: lockEnabled, lockType, frequency, setFrequency, graceMinutes, setGraceMinutes } = useAppLock();
  const notifs = useNotifications();
  const {
    wallets, categories, transactions, debts, subscriptions, gamiyas, budgets, pendingWrites,
    addWallet, updateWallet, deleteWallet, archiveWallet, restoreWallet,
    addCategory, updateCategory, deleteCategory, archiveCategory, restoreCategory,
  } = useData();
  const { walletColors, categoryColors } = useChartColors();
  const [newWallet, setNewWallet] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [lockModalMode, setLockModalMode] = useState<'enable' | 'change' | 'disable' | null>(null);
  const [sheet, setSheet] = useState<{
    kind: 'wallet' | 'category';
    id: string;
    name: string;
    items: ReassignItem[];
    targets: ReassignTarget[];
    note?: string;
  } | null>(null);

  // خانتين الأرقام في المحفظة. كل منطق الحفظ (متكتبش من غير تغيير، ارفض
  // الكلام اللي مش رقم، اسأل قبل السالب، احفظ لوحدك قبل ما الشاشة تتشال)
  // في `useAmountDrafts` — الشاشة بتوصّل بس القراية والكتابة.
  const opening = useAmountDrafts(
    id => wallets.find(w => w.id === id)?.openingBalance ?? 0,
    (id, value) => updateWallet(id, { openingBalance: value }),
  );
  const lowAlert = useAmountDrafts(
    id => wallets.find(w => w.id === id)?.lowAlert ?? 0,
    (id, value) => updateWallet(id, { lowAlert: value }),
  );
  const { busy: addingWallet, run: runAddWallet } = useBusy();
  const { busy: addingCategory, run: runAddCategory } = useBusy();
  const { busyKey: deletingKey, run: runDelete } = useBusyKey();

  const activeWallets = useMemo(() => wallets.filter(w => !w.archived), [wallets]);
  const archivedWallets = useMemo(() => wallets.filter(w => w.archived), [wallets]);
  const activeCategories = useMemo(() => categories.filter(c => !c.archived), [categories]);
  const archivedCategories = useMemo(() => categories.filter(c => c.archived), [categories]);

  function walletRefsFor(id: string) {
    return walletReferences(id, { transactions, debts, subscriptions, gamiyas });
  }
  function categoryRefsFor(id: string) {
    return categoryReferences(id, { transactions, subscriptions, debts, budgets });
  }

  /** رسالة المانع — نفس الكلام للمحفظة والفئة بصياغة كل واحدة */
  function showArchiveBlock(block: ArchiveBlock, name: string, isWallet: boolean) {
    if (block.kind === 'last-active') {
      Alert.alert(
        isWallet ? 'دي آخر محفظة شغالة' : 'دي آخر فئة شغالة',
        isWallet
          ? 'لازم يفضل عندك محفظة واحدة على الأقل عشان تقدر تسجّل عملياتك. اعمل محفظة تانية الأول.'
          : 'لازم تفضل عندك فئة واحدة على الأقل عشان تصنّف مصاريفك. اعمل فئة تانية الأول.',
        [{ text: 'تمام' }]
      );
      return;
    }
    if (block.kind === 'balance') {
      Alert.alert(
        'رصيدها لسه مش صفر',
        `رصيد "${name}" ${fmt(block.balance)} ج.م، لازم يبقى صفر قبل الأرشفة. حوّله لمحفظة تانية الأول.`,
        [{ text: 'تمام' }]
      );
      return;
    }
    Alert.alert(
      isWallet ? 'مفيش محفظة تانية' : 'مفيش فئة تانية',
      isWallet
        ? 'الاشتراكات والجمعيات الشغالة محتاجة محفظة تتنقل لها. اعمل محفظة تانية الأول.'
        : 'الاشتراكات الشغالة محتاجة فئة تتنقل لها. اعمل فئة تانية الأول.',
      [{ text: 'تمام' }]
    );
  }

  /* ───────────────  المحافظ: حذف / أرشفة / رجوع  ─────────────── */

  function confirmDeleteWallet(id: string, name: string) {
    const refs = walletRefsFor(id);
    if (!walletHasHistory(refs)) {
      Alert.alert('حذف محفظة', `متأكد إنك عايز تمسح "${name}"؟ مفيش أي عملية أو دين مربوط بيها.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'حذف', style: 'destructive', onPress: () => runDelete(`w_${id}`, () => deleteWallet(id)) },
      ]);
      return;
    }
    // ليها تاريخ: الأرشفة هي الطريق الطبيعي، والمسح النهائي فاضل آخر خيار
    // وبلون التحذير — بس مبيمسحش على طول، بيوري الأرقام الأول
    Alert.alert(
      'المحفظة دي ليها تاريخ',
      `"${name}" مربوط بيها ${walletLinkSummary(refs)}. لو مسحتها التاريخ هيفضل من غير اسم محفظة. تقدر تأرشفها بدل كده — هتختفي من الاختيارات وتفضل ظاهرة في التاريخ.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchiveWallet(id, name) },
        { text: 'امسحها برضه', style: 'destructive', onPress: () => confirmHardDeleteWallet(id, name) },
      ]
    );
  }

  /**
   * التأكيد التاني: الأرقام الحقيقية قبل المسح النهائي. المستخدم بياخد
   * القرار وهو شايف التمن، مش بعد ما يدفعه.
   */
  function confirmHardDeleteWallet(id: string, name: string) {
    const w = wallets.find(x => x.id === id);
    if (!w) return;
    const balance = roundedWalletBalance(transactions, id, w.openingBalance);
    const lines = walletDeleteConsequences({ balance, refs: walletRefsFor(id) });
    Alert.alert('مسح نهائي', lines.join('\n'), [
      { text: 'ارجع', style: 'cancel' },
      { text: 'امسحها نهائي', style: 'destructive', onPress: () => runDelete(`w_${id}`, () => deleteWallet(id)) },
    ]);
  }

  function startArchiveWallet(id: string, name: string) {
    const w = wallets.find(x => x.id === id);
    if (!w) return;
    const refs = walletRefsFor(id);
    const others = activeWallets.filter(x => x.id !== id);
    const block = walletArchiveBlock({
      walletId: id,
      balance: roundedWalletBalance(transactions, id, w.openingBalance),
      refs,
      activeWalletCount: activeWallets.length,
      otherActiveWalletCount: others.length,
    });
    if (block) { showArchiveBlock(block, name, true); return; }

    const items: ReassignItem[] = [
      ...refs.activeSubscriptions.map(x => ({ ...x, kind: 'اشتراك' })),
      ...refs.activeGamiyas.map(x => ({ ...x, kind: 'جمعية' })),
    ];
    if (items.length === 0) {
      Alert.alert('أرشفة محفظة', `هنأرشف "${name}". هتختفي من الاختيارات وتفضل ظاهرة في التاريخ.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => archiveWallet(id, {}) },
      ]);
      return;
    }
    setSheet({
      kind: 'wallet', id, name, items,
      targets: others.map(x => ({ id: x.id, name: x.name })),
    });
  }

  function confirmRestoreWallet(id: string, name: string) {
    Alert.alert('رجّع المحفظة', `"${name}" هترجع تظهر في الاختيارات تاني.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'رجّعها', onPress: () => restoreWallet(id) },
    ]);
  }

  /* ───────────────  الفئات: حذف / أرشفة / رجوع  ─────────────── */

  function confirmDeleteCategory(id: string, name: string) {
    const refs = categoryRefsFor(id);
    if (!categoryHasHistory(refs)) {
      const budgetNote = refs.hasBudget ? ' وميزانيتها هتتمسح معاها.' : '';
      Alert.alert('حذف فئة', `متأكد إنك عايز تمسح "${name}"؟ مفيش أي عملية عليها.${budgetNote}`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'حذف', style: 'destructive', onPress: () => runDelete(`c_${id}`, () => deleteCategory(id)) },
      ]);
      return;
    }
    Alert.alert(
      'الفئة دي عليها عمليات',
      `"${name}" عليها ${categoryLinkSummary(refs)}. لو مسحتها العمليات هتفضل من غير فئة. تقدر تأرشفها بدل كده.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchiveCategory(id, name) },
        { text: 'امسحها برضه', style: 'destructive', onPress: () => confirmHardDeleteCategory(id, name) },
      ]
    );
  }

  function confirmHardDeleteCategory(id: string, name: string) {
    const lines = categoryDeleteConsequences(categoryRefsFor(id));
    Alert.alert('مسح نهائي', lines.join('\n'), [
      { text: 'ارجع', style: 'cancel' },
      { text: 'امسحها نهائي', style: 'destructive', onPress: () => runDelete(`c_${id}`, () => deleteCategory(id)) },
    ]);
  }

  function startArchiveCategory(id: string, name: string) {
    const refs = categoryRefsFor(id);
    const others = activeCategories.filter(x => x.id !== id);
    const block = categoryArchiveBlock({
      refs,
      activeCategoryCount: activeCategories.length,
      otherActiveCategoryCount: others.length,
    });
    if (block) { showArchiveBlock(block, name, false); return; }

    const budgetNote = refs.hasBudget ? ' ونمسح ميزانيتها الشهرية' : '';
    if (refs.activeSubscriptions.length === 0) {
      Alert.alert('أرشفة فئة', `هنأرشف "${name}"${budgetNote}. العمليات القديمة هتفضل زي ما هي.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => archiveCategory(id, {}) },
      ]);
      return;
    }
    setSheet({
      kind: 'category', id, name,
      items: refs.activeSubscriptions.map(x => ({ ...x, kind: 'اشتراك' })),
      targets: others.map(x => ({ id: x.id, name: x.name })),
      note: refs.hasBudget ? 'وهنمسح كمان ميزانيتها الشهرية.' : undefined,
    });
  }

  function confirmRestoreCategory(id: string, name: string) {
    Alert.alert('رجّع الفئة', `"${name}" هترجع من غير ميزانية، تقدر تحددلها ميزانية من جديد.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'رجّعها', onPress: () => restoreCategory(id) },
    ]);
  }

  /** بينقل الاشتراكات/الجمعيات ويأرشف في دفعة واحدة ذرية */
  function confirmSheet(assignments: Record<string, string>) {
    if (!sheet) return;
    if (sheet.kind === 'wallet') {
      const subIds = new Set(sheet.items.filter(i => i.kind === 'اشتراك').map(i => i.id));
      const subscriptionsMap: Record<string, string> = {};
      const gamiyasMap: Record<string, string> = {};
      Object.entries(assignments).forEach(([itemId, target]) => {
        if (subIds.has(itemId)) subscriptionsMap[itemId] = target;
        else gamiyasMap[itemId] = target;
      });
      archiveWallet(sheet.id, { subscriptions: subscriptionsMap, gamiyas: gamiyasMap });
    } else {
      archiveCategory(sheet.id, assignments);
    }
    setSheet(null);
  }
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

  function clearNameDraft(key: string) {
    setNameDrafts(d => {
      if (d[key] === undefined) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });
  }

  /**
   * نفس قاعدة خانات الأرقام: الخروج من الخانة مبيكتبش لو مفيش تغيير. الاسم
   * الفاضي مترفوض (قواعد Firestore بترفضه أصلاً) والخانة بترجع للمحفوظ.
   */
  function saveEditedName(key: string, current: string, write: (name: string) => void) {
    const val = nameDrafts[key];
    if (val === undefined) return;
    const name = val.trim();
    if (!name || name === current) { clearNameDraft(key); return; }
    clearNameDraft(key);
    write(name);
  }

  function walletNameValue(id: string, current: string) {
    return nameDrafts[`w_${id}`] !== undefined ? nameDrafts[`w_${id}`] : current;
  }
  function saveWalletName(id: string, current: string) {
    saveEditedName(`w_${id}`, current, name => updateWallet(id, { name }));
  }
  function catNameValue(id: string, current: string) {
    return nameDrafts[`c_${id}`] !== undefined ? nameDrafts[`c_${id}`] : current;
  }
  function saveCatName(id: string, current: string) {
    saveEditedName(`c_${id}`, current, name => updateCategory(id, { name }));
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>الإعدادات</Text>
        <Text style={styles.email}>{user?.email}</Text>

        <TouchableOpacity style={styles.archiveBtn} onPress={() => router.push('/archive')}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>📄 أرشيف العمليات وتصدير إكسيل</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.archiveBtn} onPress={() => router.push('/user-guide')}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>📖 دليل المستخدم</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.archiveBtn} onPress={replayOnboarding}>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>🔄 إعادة عرض شاشة الترحيب</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>الإشعارات</Text>
        {!notifs.enabled ? (
          <>
            <Text style={styles.hint}>فعّل الإشعارات عشان توصلك تذكيرات الاشتراكات والجمعية حتى والتطبيق مقفول</Text>
            <TouchableOpacity
              style={styles.archiveBtn}
              onPress={async () => {
                const ok = await notifs.enableNotifications();
                if (!ok) {
                  Alert.alert('محتاج إذن', 'لازم تسمح للتطبيق يبعتلك إشعارات من إعدادات الموبايل.');
                }
              }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>🔔 تفعيل الإشعارات</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.securityCard}>
            <Text style={styles.securityStatus}>الإشعارات مفعّلة</Text>
            <Text style={styles.hint}>هتوصلك تذكيرات قبل مواعيد الاشتراكات وأقساط الجمعية</Text>

            <View style={[styles.row, { marginTop: 8 }]}>
              <TouchableOpacity
                onPress={() => notifs.setDailyEnabled(true)}
                style={[styles.typeBtn, selectionStyle(colors, notifs.dailyEnabled)]}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>تذكير يومي</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => notifs.setDailyEnabled(false)}
                style={[styles.typeBtn, selectionStyle(colors, !notifs.dailyEnabled)]}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>من غير تذكير يومي</Text>
              </TouchableOpacity>
            </View>

            {notifs.dailyEnabled && (
              <>
                <Text style={[styles.hint, { marginTop: 12 }]}>التذكير اليومي الساعة كام؟</Text>
                <View style={styles.row}>
                  {[14, 18, 20, 22].map(h => (
                    <TouchableOpacity
                      key={h}
                      onPress={() => notifs.setDailyHour(h)}
                      style={[styles.graceBtn, selectionStyle(colors, notifs.dailyHour === h)]}>
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>{h > 12 ? h - 12 : h} {h >= 12 ? 'م' : 'ص'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity style={[styles.disableBtn, { marginTop: 14 }]} onPress={() => notifs.disableNotifications()}>
              <Text style={{ color: colors.danger, fontSize: 12.5 }}>إيقاف الإشعارات</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle}>الأمان</Text>
        {!lockEnabled ? (
          <TouchableOpacity style={styles.securityBtn} onPress={() => setLockModalMode('enable')}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>🔒 تفعيل قفل التطبيق</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.securityCard}>
            <Text style={styles.securityStatus}>
              القفل مفعّل ({lockType === 'pin' ? 'رقم سري' : 'باسورد نصي'})
            </Text>
            <Text style={styles.hint}>يطلب الباسورد إمتى؟</Text>
            <View style={styles.row}>
              <TouchableOpacity onPress={() => setFrequency('onOpen')}
                style={[styles.typeBtn, selectionStyle(colors, frequency === 'onOpen')]}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>مرة واحدة (فتح التطبيق)</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setFrequency('everyResume')}
                style={[styles.typeBtn, selectionStyle(colors, frequency === 'everyResume')]}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>كل مرة ترجع للتطبيق</Text>
              </TouchableOpacity>
            </View>

            {frequency === 'everyResume' && (
              <>
                <Text style={[styles.hint, { marginTop: 14 }]}>يقفل بعد قد إيه من خروجك من التطبيق؟</Text>
                <View style={styles.row}>
                  {[
                    { m: 0, label: 'فورًا' },
                    { m: 1, label: 'بعد دقيقة' },
                    { m: 5, label: 'بعد 5 دقايق' },
                    { m: 15, label: 'بعد 15 دقيقة' },
                  ].map(opt => (
                    <TouchableOpacity key={opt.m} onPress={() => setGraceMinutes(opt.m)}
                      style={[styles.graceBtn, selectionStyle(colors, graceMinutes === opt.m)]}>
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <View style={[styles.row, { marginTop: 14 }]}>
              <TouchableOpacity style={styles.changeBtn} onPress={() => setLockModalMode('change')}>
                <Text style={{ color: colors.text, fontSize: 12.5 }}>تغيير الباسورد</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.disableBtn} onPress={() => setLockModalMode('disable')}>
                <Text style={{ color: colors.danger, fontSize: 12.5 }}>إلغاء القفل</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>الشكل</Text>
        <View style={styles.themeRow}>
          <TouchableOpacity
            onPress={() => setTheme('dark')}
            style={[styles.themeBtn, selectionStyle(colors, theme === 'dark')]}>
            <Text style={{ color: theme === 'dark' ? colors.text : colors.textSecondary, fontSize: 13.5 }}>داكن</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTheme('light')}
            style={[styles.themeBtn, selectionStyle(colors, theme === 'light')]}>
            <Text style={{ color: theme === 'light' ? colors.text : colors.textSecondary, fontSize: 13.5 }}>فاتح</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>المحافظ</Text>
        <Text style={styles.hint}>تقدر تدوس على اسم المحفظة تعدله مباشرة</Text>
        {activeWallets.map(w => (
          <View key={w.id} style={styles.walletCard}>
            <View style={styles.walletHead}>
              <View style={[styles.dot, { backgroundColor: walletColors.get(w.id) }]} />
              <TextInput
                style={styles.nameInput}
                value={walletNameValue(w.id, w.name)}
                onChangeText={v => setNameDrafts(d => ({ ...d, [`w_${w.id}`]: v }))}
                onBlur={() => saveWalletName(w.id, w.name)}
                textAlign="right"
              />
              <TouchableOpacity onPress={() => confirmDeleteWallet(w.id, w.name)} disabled={deletingKey === `w_${w.id}`}>
                <Text style={[styles.deleteText, deletingKey === `w_${w.id}` && styles.btnBusy]}>{deletingKey === `w_${w.id}` ? '...' : 'حذف'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.walletRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.microLabel}>الرصيد الابتدائي</Text>
                <TextInput
                  style={styles.smallInput}
                  keyboardType="numeric"
                  value={opening.valueFor(w.id, w.openingBalance)}
                  onChangeText={v => opening.onChange(w.id, v)}
                  onBlur={() => opening.onBlur(w.id)}
                  textAlign="right"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.microLabel}>حد التنبيه</Text>
                <TextInput
                  style={styles.smallInput}
                  keyboardType="numeric"
                  value={lowAlert.valueFor(w.id, w.lowAlert)}
                  onChangeText={v => lowAlert.onChange(w.id, v)}
                  onBlur={() => lowAlert.onBlur(w.id)}
                  textAlign="right"
                />
              </View>
            </View>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput style={styles.addInput} placeholder="اسم محفظة جديدة" placeholderTextColor={colors.textSecondary}
            value={newWallet} onChangeText={setNewWallet} textAlign="right" />
          <TouchableOpacity
            style={[styles.addBtn, addingWallet && styles.btnBusy]}
            disabled={addingWallet}
            onPress={() => {
              const name = newWallet.trim();
              if (!name) return;
              runAddWallet(async () => {
                await addWallet(name);
                setNewWallet('');
              });
            }}>
            <Text style={styles.addBtnText}>{addingWallet ? '...' : '+'}</Text>
          </TouchableOpacity>
        </View>

        <ArchivedSection
          title="المحافظ المؤرشفة"
          items={archivedWallets}
          styles={styles}
          colors={colors}
          onRestore={confirmRestoreWallet}
        />

        <Text style={styles.sectionTitle}>الفئات</Text>
        <Text style={styles.hint}>تقدر تدوس على اسم الفئة تعدله مباشرة</Text>
        {activeCategories.map(c => (
          <View key={c.id} style={styles.catRow}>
            <View style={[styles.dot, { backgroundColor: categoryColors.get(c.id) }]} />
            <TextInput
              style={styles.nameInput}
              value={catNameValue(c.id, c.name)}
              onChangeText={v => setNameDrafts(d => ({ ...d, [`c_${c.id}`]: v }))}
              onBlur={() => saveCatName(c.id, c.name)}
              textAlign="right"
            />
            <TouchableOpacity onPress={() => confirmDeleteCategory(c.id, c.name)} disabled={deletingKey === `c_${c.id}`}>
              <Text style={[styles.deleteText, deletingKey === `c_${c.id}` && styles.btnBusy]}>{deletingKey === `c_${c.id}` ? '...' : 'حذف'}</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput style={styles.addInput} placeholder="فئة جديدة" placeholderTextColor={colors.textSecondary}
            value={newCategory} onChangeText={setNewCategory} textAlign="right" />
          <TouchableOpacity
            style={[styles.addBtn, addingCategory && styles.btnBusy]}
            disabled={addingCategory}
            onPress={() => {
              const name = newCategory.trim();
              if (!name) return;
              runAddCategory(async () => {
                await addCategory(name);
                setNewCategory('');
              });
            }}>
            <Text style={styles.addBtnText}>{addingCategory ? '...' : '+'}</Text>
          </TouchableOpacity>
        </View>

        <ArchivedSection
          title="الفئات المؤرشفة"
          items={archivedCategories}
          styles={styles}
          colors={colors}
          onRestore={confirmRestoreCategory}
        />

        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout}>
          <Text style={styles.logoutText}>تسجيل الخروج</Text>
        </TouchableOpacity>

        {lockModalMode && (
          <SetLockModal visible={!!lockModalMode} mode={lockModalMode} onClose={() => setLockModalMode(null)} />
        )}

        {sheet && (
          <ArchiveSheet
            title={sheet.kind === 'wallet' ? 'أرشفة محفظة' : 'أرشفة فئة'}
            intro={sheet.kind === 'wallet'
              ? `قبل ما نأرشف "${sheet.name}" لازم الحاجات الشغالة دي تلاقي محفظة تانية.`
              : `قبل ما نأرشف "${sheet.name}" لازم الاشتراكات الشغالة دي تلاقي فئة تانية.`}
            items={sheet.items}
            targets={sheet.targets}
            targetLabel={sheet.kind === 'wallet' ? 'المحفظة الجديدة' : 'الفئة الجديدة'}
            note={sheet.note}
            confirmText="أرشفها"
            onConfirm={confirmSheet}
            onClose={() => setSheet(null)}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * قسم المؤرشف — مطوي افتراضيًا. المستخدم أرشفها عشان تختفي، فلو فتحناها
 * على طول كنا رجّعنا نفس الزحمة اللي هرب منها. العنوان بيقول العدد عشان
 * يعرف إن فيه حاجة هناك أصلاً من غير ما يفتح.
 */
function ArchivedSection({ title, items, styles, colors, onRestore }: {
  title: string;
  items: { id: string; name: string }[];
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onRestore: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <View style={styles.archivedWrap}>
      <TouchableOpacity style={styles.archivedHead} onPress={() => setOpen(o => !o)}>
        <Text style={styles.archivedTitle}>{title} ({items.length})</Text>
        <Text style={styles.archivedChevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && items.map(item => (
        <View key={item.id} style={styles.archivedRow}>
          <Text style={styles.archivedName}>{item.name}</Text>
          <TouchableOpacity onPress={() => onRestore(item.id, item.name)}>
            <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '700' }}>رجّعها</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    // 60 كانت عشان الزرار العايم اللي كان بيغطي آخر الشاشة. الزرار مابقاش
    // بيظهر في الإعدادات، فرجّعنا نفس الهامش العادي بتاع باقي الشاشات (40)
    content: { padding: 16, paddingBottom: 40 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    email: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginBottom: 18 },
    archiveBtn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 13, marginBottom: 10 },
    securityBtn: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 13 },
    securityCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border },
    securityStatus: { color: c.success, fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 10 },
    row: { flexDirection: 'row-reverse', gap: 8 },
    typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    graceBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 9 },
    changeBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    disableBtn: { flex: 1, borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10, alignItems: 'center', paddingVertical: 10 },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 20, marginBottom: 4 },
    hint: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginBottom: 10 },
    themeRow: { flexDirection: 'row-reverse', gap: 10, marginBottom: 6 },
    themeBtn: { flex: 1, backgroundColor: c.surface, borderWidth: 1.5, borderRadius: 12, alignItems: 'center', paddingVertical: 14 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    walletCard: { backgroundColor: c.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    walletHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 10 },
    nameInput: { flex: 1, color: c.text, fontSize: 14, fontWeight: '500', textAlign: 'right', paddingVertical: 2 },
    walletRow: { flexDirection: 'row-reverse', gap: 10 },
    microLabel: { color: c.textMuted, fontSize: 10.5, textAlign: 'right', marginBottom: 3 },
    smallInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, color: c.text, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12.5 },
    catRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.border },
    deleteText: { color: c.danger, fontSize: 12.5 },
    addRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 10, marginBottom: 6, alignItems: 'center' },
    addInput: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
    addBtn: { backgroundColor: c.accent, borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    addBtnText: { color: c.onAccent, fontSize: 20, fontWeight: '700' },
    btnBusy: { opacity: 0.6 },
    archivedWrap: { marginTop: 14, borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
    archivedHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface2, paddingHorizontal: 12, paddingVertical: 11 },
    archivedTitle: { color: c.textSecondary, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
    archivedChevron: { color: c.textMuted, fontSize: 12 },
    archivedRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
    archivedName: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
    logoutBtn: { borderWidth: 1, borderColor: c.dangerBorder, borderRadius: 10, alignItems: 'center', paddingVertical: 12, marginTop: 30 },
    logoutText: { color: c.danger, fontSize: 14, fontWeight: '600' },
  });
}