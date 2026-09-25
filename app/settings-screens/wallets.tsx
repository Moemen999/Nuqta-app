import { plainAmount } from '@/lib/money';
import ArchiveSheet, { type ReassignItem, type ReassignTarget } from '@/components/ArchiveSheet';
import ArchivedList from '@/components/ArchivedList';
import ListEmptyState from '@/components/ListEmptyState';
import BackButton from '@/components/BackButton';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import {
  roundedWalletBalance, walletArchiveBlock, walletDeleteConsequences, walletHasHistory,
  walletLinkSummary, walletReferences, type ArchiveBlock,
} from '@/lib/archiving';
import { useAmountDrafts } from '@/lib/useAmountDrafts';
import { useBusy, useBusyKey } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * إدارة المحافظ. اتنقلت من شاشة الإعدادات زي ما هي — منطق الحفظ ما اتغيرش
 * ولا حرف: نفس `useAmountDrafts` (متكتبش من غير تغيير، ارفض الكلام اللي مش
 * رقم، اسأل قبل السالب، احفظ لوحدك قبل ما الشاشة تتشال)، ونفس مسوّدات
 * الأسماء، ونفس مسارات الحذف والأرشفة.
 *
 * الفرق الوحيد إن مسوّدات الأسماء مابقاش لها بادئة `w_`: البادئة كانت موجودة
 * عشان المحافظ والفئات كانوا بيتشاركوا خريطة واحدة في شاشة واحدة. دلوقتي كل
 * شاشة ليها خريطتها، فالمعرّف لوحده كفاية.
 */
export default function WalletsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    wallets, transactions, debts, subscriptions, gamiyas, incomes,
    addWallet, updateWallet, deleteWallet, archiveWallet, restoreWallet,
  } = useData();
  const { walletColors } = useChartColors();

  const [newWallet, setNewWallet] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{
    id: string; name: string; items: ReassignItem[]; targets: ReassignTarget[];
  } | null>(null);

  const opening = useAmountDrafts(
    id => wallets.find(w => w.id === id)?.openingBalance ?? 0,
    (id, value) => updateWallet(id, { openingBalance: value }),
  );
  const lowAlert = useAmountDrafts(
    id => wallets.find(w => w.id === id)?.lowAlert ?? 0,
    (id, value) => updateWallet(id, { lowAlert: value }),
  );
  const { busy: adding, run: runAdd } = useBusy();
  const { busyKey: deletingKey, run: runDelete } = useBusyKey();

  const activeWallets = useMemo(() => wallets.filter(w => !w.archived), [wallets]);
  const archivedWallets = useMemo(() => wallets.filter(w => w.archived), [wallets]);

  function refsFor(id: string) {
    return walletReferences(id, { transactions, debts, subscriptions, gamiyas, incomes });
  }

  function clearNameDraft(id: string) {
    setNameDrafts(d => {
      if (d[id] === undefined) return d;
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  /** نفس قاعدة خانات الأرقام: الخروج من الخانة مبيكتبش لو مفيش تغيير */
  function saveName(id: string, current: string) {
    const val = nameDrafts[id];
    if (val === undefined) return;
    const name = val.trim();
    if (!name || name === current) { clearNameDraft(id); return; }
    clearNameDraft(id);
    updateWallet(id, { name });
  }

  function showBlock(block: ArchiveBlock, name: string) {
    if (block.kind === 'last-active') {
      Alert.alert('دي آخر محفظة شغالة',
        'لازم يفضل عندك محفظة واحدة على الأقل عشان تقدر تسجّل عملياتك. اعمل محفظة تانية الأول.',
        [{ text: 'تمام' }]);
      return;
    }
    if (block.kind === 'balance') {
      Alert.alert('رصيدها لسه مش صفر',
        `رصيد "${name}" ${plainAmount(block.balance)} ج.م، لازم يبقى صفر قبل الأرشفة. حوّله لمحفظة تانية الأول.`,
        [{ text: 'تمام' }]);
      return;
    }
    Alert.alert('مفيش محفظة تانية',
      'الاشتراكات والجمعيات والدخل الثابت الشغالة محتاجة محفظة تتنقل لها. اعمل محفظة تانية الأول.',
      [{ text: 'تمام' }]);
  }

  function confirmDelete(id: string, name: string) {
    const refs = refsFor(id);
    if (!walletHasHistory(refs)) {
      Alert.alert('حذف محفظة', `متأكد إنك عايز تمسح "${name}"؟ مفيش أي عملية أو دين مربوط بيها.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'حذف', style: 'destructive', onPress: () => runDelete(id, () => deleteWallet(id)) },
      ]);
      return;
    }
    Alert.alert('المحفظة دي ليها تاريخ',
      `"${name}" مربوط بيها ${walletLinkSummary(refs)}. لو مسحتها التاريخ هيظهر باسم محفظة ممسوحة. تقدر تأرشفها بدل كده — هتختفي من الاختيارات وتفضل ظاهرة في التاريخ.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchive(id, name) },
        { text: 'امسحها برضه', style: 'destructive', onPress: () => confirmHardDelete(id, name) },
      ]);
  }

  /** التأكيد التاني: الأرقام الحقيقية قبل المسح النهائي */
  function confirmHardDelete(id: string, name: string) {
    const w = wallets.find(x => x.id === id);
    if (!w) return;
    const balance = roundedWalletBalance(transactions, id, w.openingBalance);
    Alert.alert('مسح نهائي', walletDeleteConsequences({ balance, refs: refsFor(id) }).join('\n'), [
      { text: 'ارجع', style: 'cancel' },
      { text: 'امسحها نهائي', style: 'destructive', onPress: () => runDelete(id, () => deleteWallet(id)) },
    ]);
  }

  /** شروط الأرشفة على البيانات **دلوقتي** — بتتنادى وقت فتح الشيت ووقت التأكيد */
  function archiveBlockFor(id: string) {
    const w = wallets.find(x => x.id === id);
    if (!w) return null;
    return walletArchiveBlock({
      walletId: id,
      balance: roundedWalletBalance(transactions, id, w.openingBalance),
      refs: refsFor(id),
      activeWalletCount: activeWallets.length,
      otherActiveWalletCount: activeWallets.filter(x => x.id !== id).length,
    });
  }

  function startArchive(id: string, name: string) {
    if (!wallets.some(x => x.id === id)) return;
    const refs = refsFor(id);
    const others = activeWallets.filter(x => x.id !== id);
    const block = archiveBlockFor(id);
    if (block) { showBlock(block, name); return; }

    const items: ReassignItem[] = [
      ...refs.activeSubscriptions.map(x => ({ ...x, kind: 'اشتراك' })),
      ...refs.activeGamiyas.map(x => ({ ...x, kind: 'جمعية' })),
      ...refs.activeIncomes.map(x => ({ ...x, kind: 'دخل ثابت' })),
    ];
    if (items.length === 0) {
      Alert.alert('أرشفة محفظة', `هنأرشف "${name}". هتختفي من الاختيارات وتفضل ظاهرة في التاريخ.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => archiveWallet(id, {}) },
      ]);
      return;
    }
    setSheet({ id, name, items, targets: others.map(x => ({ id: x.id, name: x.name })) });
  }

  function confirmRestore(id: string, name: string) {
    Alert.alert('رجّع المحفظة', `"${name}" هترجع تظهر في الاختيارات تاني.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'رجّعها', onPress: () => restoreWallet(id) },
    ]);
  }

  function confirmSheet(assignments: Record<string, string>) {
    if (!sheet) return;
    // الشيت ممكن يفضل مفتوح وحاجة تتغيّر من جهاز تاني: عملية جديدة على
    // المحفظة، أو اشتراك/جمعية اتمسحوا ومعاهم دفعاتهم (money-reviewer). الرصيد
    // اتفحص وقت الفتح بس، فكانت بتتأرشف ورصيدها مش صفر ومحدش شايفه
    // المحفظة نفسها اتمسحت من جهاز تاني: archiveBlockFor بيرجّع null ساعتها
    // زي "مفيش مانع"، فكانت بتعدّي لأرشفة مستند مش موجود (silent-failure-hunter)
    if (!wallets.some(w => w.id === sheet.id)) {
      setSheet(null);
      Alert.alert('المحفظة دي اتمسحت', `"${sheet.name}" اتمسحت من جهاز تاني، فمفيش حاجة تتأرشف.`, [{ text: 'تمام' }]);
      return;
    }
    const block = archiveBlockFor(sheet.id);
    if (block) { setSheet(null); showBlock(block, sheet.name); return; }
    // حاجة من اللي في الشيت اتمسحت والرصيد لسه باين صفر: الجمعيات/الاشتراكات
    // والعمليات listeners منفصلة، فممكن المسح يوصل هنا قبل ما دفعاتها تتشال من
    // الرصيد (money-reviewer). منأرشفش على رقم ممكن يكون قديم — افتحها تاني
    const live = new Set([...subscriptions, ...gamiyas, ...incomes].map(x => x.id));
    if (sheet.items.some(i => !live.has(i.id))) {
      setSheet(null);
      Alert.alert('فيه حاجة اتغيّرت',
        `حاجة من اللي كنت بتنقلها اتمسحت من جهاز تاني. افتح الأرشفة تاني عشان نتأكد إن رصيد "${sheet.name}" لسه صفر.`,
        [{ text: 'تمام' }]);
      return;
    }
    // بالنوع صريح مش "أي حاجة مش اشتراك = جمعية": الدخل الثابت كان هيتبعت
    // كجمعية ويتكتب في مستند مش موجود فالدفعة كلها تفشل
    const kindOf = new Map(sheet.items.map(i => [i.id, i.kind]));
    const subscriptionsMap: Record<string, string> = {};
    const gamiyasMap: Record<string, string> = {};
    const incomesMap: Record<string, string> = {};
    Object.entries(assignments).forEach(([itemId, target]) => {
      const kind = kindOf.get(itemId);
      if (kind === 'اشتراك') subscriptionsMap[itemId] = target;
      else if (kind === 'دخل ثابت') incomesMap[itemId] = target;
      else gamiyasMap[itemId] = target;
    });
    archiveWallet(sheet.id, { subscriptions: subscriptionsMap, gamiyas: gamiyasMap, incomes: incomesMap });
    setSheet(null);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.headerRow}>
          <BackButton />
          <Text style={styles.title}>المحافظ</Text>
        </View>
        <Text style={styles.hint}>تقدر تدوس على اسم المحفظة تعدله مباشرة</Text>

        {activeWallets.length === 0 && (
          <ListEmptyState testID="wallets_empty" message="لسه مفيش محافظ شغالة. اعمل واحدة من تحت." />
        )}

        {activeWallets.map(w => (
          <View key={w.id} testID={`wallet_row_${w.id}`} style={styles.walletCard}>
            <View style={styles.walletHead}>
              <View style={[styles.dot, { backgroundColor: walletColors.get(w.id) }]} />
              <TextInput
                testID={`wallet_name_input_${w.id}`}
                style={styles.nameInput}
                value={nameDrafts[w.id] !== undefined ? nameDrafts[w.id] : w.name}
                onChangeText={v => setNameDrafts(d => ({ ...d, [w.id]: v }))}
                onBlur={() => saveName(w.id, w.name)}
                textAlign="right"
              />
              <TouchableOpacity testID={`wallet_delete_${w.id}`} onPress={() => confirmDelete(w.id, w.name)} disabled={deletingKey === w.id}>
                <Text style={[styles.deleteText, deletingKey === w.id && styles.btnBusy]}>
                  {deletingKey === w.id ? '...' : 'حذف'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.walletRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.microLabel}>الرصيد الابتدائي</Text>
                <TextInput
                  testID={`wallet_opening_input_${w.id}`}
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
                  testID={`wallet_alert_input_${w.id}`}
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
          <TextInput testID="wallet_add_input" style={styles.addInput} placeholder="اسم محفظة جديدة" placeholderTextColor={colors.textSecondary}
            value={newWallet} onChangeText={setNewWallet} textAlign="right" />
          <TouchableOpacity
            testID="wallet_add_button"
            style={[styles.addBtn, adding && styles.btnBusy]}
            disabled={adding}
            onPress={() => {
              const name = newWallet.trim();
              if (!name) return;
              runAdd(async () => { await addWallet(name); setNewWallet(''); });
            }}>
            <Text style={styles.addBtnText}>{adding ? '...' : '+'}</Text>
          </TouchableOpacity>
        </View>

        <ArchivedList title="المحافظ المؤرشفة" items={archivedWallets} onRestore={confirmRestore} />

        {sheet && (
          <ArchiveSheet
            title="أرشفة محفظة"
            intro={`قبل ما نأرشف "${sheet.name}" لازم الحاجات الشغالة دي تلاقي محفظة تانية.`}
            items={sheet.items}
            targets={sheet.targets}
            targetLabel="المحفظة الجديدة"
            confirmText="أرشفها"
            onConfirm={confirmSheet}
            onClose={() => setSheet(null)}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    hint: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginBottom: 10 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    walletCard: { backgroundColor: c.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    walletHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginBottom: 10 },
    nameInput: { flex: 1, color: c.text, fontSize: 14, fontWeight: '500', textAlign: 'right', paddingVertical: 2 },
    walletRow: { flexDirection: 'row-reverse', gap: 10 },
    microLabel: { color: c.textMuted, fontSize: 10.5, textAlign: 'right', marginBottom: 3 },
    smallInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, color: c.text, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12.5 },
    deleteText: { color: c.danger, fontSize: 12.5 },
    addRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 10, marginBottom: 6, alignItems: 'center' },
    addInput: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
    addBtn: { backgroundColor: c.accent, borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    addBtnText: { color: c.onAccent, fontSize: 20, fontWeight: '700' },
    btnBusy: { opacity: 0.6 },
  });
}
