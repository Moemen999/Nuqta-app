import ArchiveSheet, { type ReassignItem, type ReassignTarget } from '@/components/ArchiveSheet';
import ArchivedList, { restoredAnnouncement } from '@/components/ArchivedList';
import CategoryIconPicker from '@/components/CategoryIconPicker';
import ListEmptyState from '@/components/ListEmptyState';
import BackButton from '@/components/BackButton';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import {
  categoryArchiveBlock, categoryDeleteBlock, categoryDeleteConsequences, categoryHasHistory, categoryLinkSummary,
  categoryReferences, reassignTargetsBlock, type ArchiveBlock,
} from '@/lib/archiving';
import {
  WALLET_BLOCKED_TITLE, dataLoadingBody, categoryActionBlockedBy, categoryActionLoading, categoryBlockedBody,
} from '@/lib/listenerErrors';
import { reportAtomicFailure } from '@/lib/atomicFailure';
import { BUSY_NOTICE, useBusy, useBusyKey } from '@/lib/useBusy';
import { AUTOSAVED_ANNOUNCEMENT, SHEET_RELINKED_NOTICE, goneFromAnotherDeviceNotice, nameEmptyNotice } from '@/lib/walletCopy';
import { useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useConfirm } from '@/components/ConfirmProvider';
import { useNotice } from '@/components/NoticeProvider';
import { MIN_TOUCH, categoryIconSize, space, typeScale, radius } from '@/lib/tokens';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Button } from '@/components/Button';
import { Text, TextInput } from '@/components/AppText';
import { ScreenTitle } from '@/components/ScreenTitle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAME_MAX_LENGTH } from '@/lib/textLimits';
import { PressableScale } from '@/components/PressableScale';

function announce(text: string) {
  try { AccessibilityInfo.announceForAccessibility(text); } catch { /* زينة */ }
}

/**
 * إدارة الفئات — اتنقلت من شاشة الإعدادات بنفس منطق الحفظ بالحرف.
 *
 * **نفس قواعد المحافظ** (الميزة 10، الجولة الأخيرة): الفحص بيتعاد لحظة الدوسة على كل تأكيد من `live` (آخر بيانات
 * وصلت)، والمسح/الأرشفة بيستنوا البيانات توصل، وآخر فئة شغالة مبتتمسحش ولا بتتأرشف، والفئة اللي اتختارت للنقل لازم تكون
 * لسه شغالة، واللي بيترمي قبل الكتابة بيتقال ويوصل Sentry.
 */
export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const notice = useNotice();
  const confirm = useConfirm();
  const data = useData();
  const {
    categories, addCategory, updateCategory, deleteCategory, archiveCategory, restoreCategory,
  } = data;
  const live = useRef(data);
  live.current = data;
  const { categoryColors } = useChartColors();

  const [newCategory, setNewCategory] = useState('');
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{
    id: string; name: string; items: ReassignItem[]; targets: ReassignTarget[]; note?: string;
  } | null>(null);
  const [archiving, setArchiving] = useState(false);

  const { busy: adding, run: runAdd } = useBusy();
  const { busyKey: deletingKey, run: runDelete } = useBusyKey(() => notice(BUSY_NOTICE.title, BUSY_NOTICE.body));

  const activeCategories = useMemo(() => categories.filter(c => !c.archived), [categories]);
  const archivedCategories = useMemo(() => categories.filter(c => c.archived), [categories]);

  function refsFor(id: string) {
    const { transactions, brokenTransactions, subscriptions, debts, budgets } = live.current;
    return categoryReferences(id, { transactions: [...transactions, ...brokenTransactions], subscriptions, debts, budgets });
  }

  function clearNameDraft(id: string) {
    setNameDrafts(d => {
      if (d[id] === undefined) return d;
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  function saveName(id: string, current: string) {
    const val = nameDrafts[id];
    if (val === undefined) return;
    const name = val.trim();
    clearNameDraft(id);
    if (!name) { if (current) notice(...nameEmptyNotice('الفئة')); return; }
    if (name === current) return;
    updateCategory(id, { name });
    announce(AUTOSAVED_ANNOUNCEMENT);
  }

  function showBlock(block: ArchiveBlock, name: string, action: 'archive' | 'delete') {
    if (block.kind === 'last-active') {
      notice('دي آخر فئة شغالة',
        action === 'delete'
          ? 'لازم تفضل عندك فئة واحدة شغالة على الأقل عشان تصنّف مصاريفك. اعمل فئة تانية أو رجّع واحدة من المؤرشفة، وبعدين امسح دي.'
          : 'لازم تفضل عندك فئة واحدة على الأقل عشان تصنّف مصاريفك. اعمل فئة تانية الأول.');
      return;
    }
    if (block.kind === 'target-gone') {
      notice('فيه حاجة اتغيّرت',
        `الفئة اللي اخترتها للنقل اتأرشفت أو اتمسحت من جهاز تاني، فما أرشفناش "${name}". افتح الأرشفة تاني واختار فئة شغالة.`);
      return;
    }
    notice('مفيش فئة تانية',
      'الاشتراكات الشغالة محتاجة فئة تتنقل لها. اعمل فئة تانية الأول.');
  }

  /** لو بيانات الاستخدام ما وصلتش (اترفضت أو لسه بتوصل — H1)، بيقول كده وبيرجّع true. وقت الفتح **ولحظة الدوسة** */
  function blockedByMissingData() {
    const { loadErrors, figuresPending, undelivered, serverReachable } = live.current;
    const missing = categoryActionBlockedBy(loadErrors);
    if (missing.length > 0) { notice(WALLET_BLOCKED_TITLE, categoryBlockedBody(missing)); return true; }
    if (categoryActionLoading(figuresPending, undelivered).length > 0) { notice(WALLET_BLOCKED_TITLE, dataLoadingBody(serverReachable)); return true; }
    return false;
  }

  /** آخر فئة شغالة مبتتمسحش (بند 2) — بيقول كده وبيرجّع true */
  function blockedAsLastActive(id: string, name: string) {
    const block = categoryDeleteBlock(id, live.current.categories);
    if (!block) return false;
    showBlock(block, name, 'delete');
    return true;
  }

  /** المسح نفسه بعد فحص أخير لحظة الدوسة — ونفس حماية المحافظ للي بيترمي (بند 9) */
  function deleteNow(id: string, name: string, fromSimple = false) {
    if (blockedByMissingData()) return;
    if (!live.current.categories.some(c => c.id === id)) { notice(...goneFromAnotherDeviceNotice('الفئة', name, 'delete')); return; }
    if (blockedAsLastActive(id, name)) return;
    if (fromSimple && categoryHasHistory(refsFor(id))) { confirmDelete(id, name); return; }
    runDelete(id, async () => {
      try {
        const result = await deleteCategory(id);
        if (result?.outcome === 'blocked') showBlock(result.block, name, 'delete');
      } catch (e) {
        reportAtomicFailure('مسح الفئة', e);
        notice('حصل خطأ، جرب تاني', `"${name}" ما اتمسحتش — حصلت مشكلة قبل ما نمسحها، ومفيش حاجة اتغيّرت. جرب تاني، ولو اتكررت اقفل التطبيق وافتحه.`);
      }
    });
  }

  function confirmDelete(id: string, name: string) {
    if (blockedByMissingData()) return;
    if (blockedAsLastActive(id, name)) return;
    const refs = refsFor(id);
    if (!categoryHasHistory(refs)) {
      const budgetNote = refs.hasBudget ? ' وميزانيتها هتتمسح معاها.' : '';
      confirm('تمسح الفئة؟', `متأكد إنك عايز تمسح "${name}"؟ مفيش أي عملية عليها${budgetNote ? `،${budgetNote}` : '.'}`, [
        { text: 'سيبها', style: 'cancel' },
        { text: 'امسحها', style: 'destructive', onPress: () => deleteNow(id, name, true) },
      ]);
      return;
    }
    confirm('الفئة دي ليها تاريخ',
      `"${name}" عليها ${categoryLinkSummary(refs)}. لو مسحتها العمليات هتظهر باسم فئة ممسوحة. تقدر تأرشفها بدل كده.`,
      [
        { text: 'سيبها', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchive(id, name) },
        { text: 'امسحها برضه', style: 'destructive', onPress: () => confirmHardDelete(id, name) },
      ]);
  }

  function confirmHardDelete(id: string, name: string) {
    if (blockedByMissingData()) return;
    if (!live.current.categories.some(c => c.id === id)) { notice(...goneFromAnotherDeviceNotice('الفئة', name, 'delete')); return; }
    if (blockedAsLastActive(id, name)) return;
    confirm('مسح نهائي', categoryDeleteConsequences(refsFor(id)).join('\n'), [
      { text: 'ارجع', style: 'cancel' },
      { text: 'امسحها نهائي', style: 'destructive', onPress: () => deleteNow(id, name) },
    ]);
  }

  /** شروط الأرشفة على البيانات **دلوقتي** — وقت الفتح، ولحظة الدوسة على التأكيد البسيط والشيت (بند 2) */
  function archiveBlockFor(id: string) {
    const active = live.current.categories.filter(c => !c.archived);
    return categoryArchiveBlock({
      refs: refsFor(id),
      activeCategoryCount: active.length,
      otherActiveCategoryCount: active.filter(x => x.id !== id).length,
    });
  }

  /** نفس `startArchive` بتاع المحافظ: التأكيد البسيط بيرجع هنا (`confirmed`) فكل الفحوص بتتعاد */
  function startArchive(id: string, name: string, confirmed = false) {
    if (blockedByMissingData()) return;
    if (!live.current.categories.some(c => c.id === id)) {
      if (confirmed) notice('الفئة دي اتمسحت', `"${name}" اتمسحت من جهاز تاني، فمفيش حاجة تتأرشف.`);
      return;
    }
    const block = archiveBlockFor(id);
    if (block) { showBlock(block, name, 'archive'); return; }

    const refs = refsFor(id);
    if (refs.activeSubscriptions.length === 0) {
      if (confirmed) { void archiveNow(id, name, {}); return; }
      // الترتيب: الأرشفة الأول، وبعدها الميزانية، وبعدها العمليات (arabic-copy-reviewer)
      const budgetNote = refs.hasBudget ? ' ونمسح ميزانيتها الشهرية' : '';
      confirm('أرشفة فئة', `هنأرشف "${name}"${budgetNote}. العمليات القديمة هتفضل زي ما هي.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchive(id, name, true) },
      ]);
      return;
    }
    const others = live.current.categories.filter(x => !x.archived && x.id !== id);
    setSheet({
      id, name,
      items: refs.activeSubscriptions.map(x => ({ ...x, kind: 'اشتراك' })),
      targets: others.map(x => ({ id: x.id, name: x.name })),
      note: refs.hasBudget ? 'وهنمسح كمان ميزانيتها الشهرية.' : undefined,
    });
  }

  /** الأرشفة نفسها — DataContext بيرفض هو كمان (آخر شغالة، نقل لفئة مش شغالة)، واللي بيترمي بيتقال */
  async function archiveNow(id: string, name: string, reassign: Record<string, string>) {
    try {
      const result = await archiveCategory(id, reassign);
      if (result?.outcome === 'blocked') showBlock(result.block, name, 'archive');
    } catch (e) {
      reportAtomicFailure('أرشفة الفئة', e);
      notice('حصل خطأ، جرب تاني', `"${name}" ما اتأرشفتش — حصلت مشكلة وإحنا بنجهّز الأرشفة، ومفيش حاجة اتغيّرت. جرب تاني، ولو اتكررت اقفل التطبيق وافتحه.`);
    }
  }

  async function confirmSheet(assignments: Record<string, string>) {
    if (!sheet) return;
    const { id, name, items } = sheet;
    const refuse = (fn: () => void) => { setSheet(null); fn(); };
    if (categoryActionBlockedBy(live.current.loadErrors).length > 0
      || categoryActionLoading(live.current.figuresPending, live.current.undelivered).length > 0) {
      refuse(() => { blockedByMissingData(); });
      return;
    }
    if (!live.current.categories.some(c => c.id === id)) {
      refuse(() => notice('الفئة دي اتمسحت', `"${name}" اتمسحت من جهاز تاني، فمفيش حاجة تتأرشف.`));
      return;
    }
    const block = archiveBlockFor(id);
    if (block) { refuse(() => showBlock(block, name, 'archive')); return; }
    // اشتراك شغال جديد اتربط والشيت مفتوح ← الشيت من جديد (بند 2). اللي اتمسح بيتفوّت في DataContext
    const now = refsFor(id).activeSubscriptions;
    if (now.some(n => !items.some(i => i.id === n.id))) { refuse(() => notice(...SHEET_RELINKED_NOTICE, () => startArchive(id, name))); return; }
    const targetBlock = reassignTargetsBlock(Object.values(assignments), live.current.categories, id);
    if (targetBlock) { refuse(() => showBlock(targetBlock, name, 'archive')); return; }
    setArchiving(true);
    try {
      await archiveNow(id, name, assignments);
    } finally {
      setArchiving(false);
      setSheet(null);
    }
  }

  function confirmRestore(id: string, name: string) {
    confirm('رجّع الفئة', `"${name}" هترجع من غير ميزانية، تقدر تحددلها ميزانية من جديد.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'رجّعها', onPress: () => { restoreCategory(id); announce(restoredAnnouncement(name)); } },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.headerRow}>
          <BackButton />
          <ScreenTitle>الفئات</ScreenTitle>
        </View>
        <Text style={styles.hint}>تقدر تدوس على اسم الفئة تعدله مباشرة</Text>

        {activeCategories.length === 0 && <ListEmptyState testID="categories_empty" kind="categories" />}

        {activeCategories.map(c => (
          <View key={c.id} testID={`category_row_${c.id}`} style={styles.catRow}>
            {/* اللون كان مجرد نقطة مش بتتدوس. بقى خلفية للأيقونة، والدوسة
                بتفتح الاختيار — فمفيش صف زيادة ومفيش زرار تالت على الصف */}
            {/* الإيموجي لوحده كان بيتقري اسمه ("إيدين مضمومين") — دلوقتي بيقول بيعمل إيه (a11y-architect) */}
            <PressableScale accessibilityRole="button" accessibilityLabel={`غيّر أيقونة ${c.name}`}
              testID={`category_icon_${c.id}`}
              onPress={() => setIconFor(c.id)}
              style={styles.iconBtn}>
              <CategoryIcon icon={c.icon} size={categoryIconSize.bar} tint={categoryColors.get(c.id)} />
            </PressableScale>
            <TextInput
              testID={`category_name_input_${c.id}`}
              style={styles.nameInput}
              maxLength={NAME_MAX_LENGTH} value={nameDrafts[c.id] !== undefined ? nameDrafts[c.id] : c.name}
              onChangeText={v => setNameDrafts(d => ({ ...d, [c.id]: v }))}
              onBlur={() => saveName(c.id, c.name)}
              textAlign="right"
              accessibilityLabel={`اسم الفئة ${c.name}`}
            />
            {/* نفس "حذف" المحفظة: اسم بيقول أنهي فئة، وحالة الانشغال، وطول 44 (a11y-architect جولة 2) */}
            <PressableScale accessibilityRole="button" accessibilityLabel={`امسح فئة ${c.name}`} accessibilityState={{ busy: deletingKey === c.id, disabled: deletingKey === c.id }}
              testID={`category_delete_${c.id}`} style={styles.deleteBtn} onPress={() => confirmDelete(c.id, c.name)} disabled={deletingKey === c.id}>
              <Text style={[styles.deleteText, deletingKey === c.id && styles.btnBusy]}>
                {deletingKey === c.id ? '...' : 'امسح'}
              </Text>
            </PressableScale>
          </View>
        ))}

        <View style={styles.addRow}>
          <TextInput testID="category_add_input" style={styles.addInput} placeholder="فئة جديدة" placeholderTextColor={colors.textSecondary}
            maxLength={NAME_MAX_LENGTH} value={newCategory} onChangeText={setNewCategory} textAlign="right" accessibilityLabel="اسم فئة جديدة" />
          <Button
            testID="category_add_button"
            size="sm"
            icon="add"
            iconOnly
            label="إضافة فئة"
            style={styles.addBtn}
            busy={adding}
            onPress={() => {
              const name = newCategory.trim();
              if (!name) return;
              runAdd(async () => { await addCategory(name); setNewCategory(''); });
            }} />
        </View>

        <ArchivedList title="الفئات المؤرشفة" items={archivedCategories} onRestore={confirmRestore} />

        <CategoryIconPicker
          visible={iconFor !== null}
          current={activeCategories.find(c => c.id === iconFor)?.icon}
          others={activeCategories.filter(c => c.id !== iconFor)}
          // بيحفظ بس — الشيت بيقفل نفسه، أو بيفضل مفتوح بملاحظة لو الأيقونة مستخدمة
          onPick={icon => {
            if (iconFor) updateCategory(iconFor, { icon: icon ?? '' });
          }}
          onClose={() => setIconFor(null)}
        />

        {sheet && (
          <ArchiveSheet
            key={sheet.items.map(i => i.id).join('|')}
            title="أرشفة فئة"
            intro={`قبل ما نأرشف "${sheet.name}" لازم الاشتراكات الشغالة دي تلاقي فئة تانية.`}
            items={sheet.items}
            targets={sheet.targets}
            targetLabel="الفئة الجديدة"
            note={sheet.note}
            confirmText="أرشفها"
            busy={archiving}
            onConfirm={assignments => { void confirmSheet(assignments); }}
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
    content: { padding: space.xxl, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
    hint: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginBottom: space.md },
    iconBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    catRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.border },
    nameInput: { flex: 1, color: c.text, fontSize: typeScale.body, fontWeight: '500', textAlign: 'right', paddingVertical: 2, minHeight: MIN_TOUCH },
    deleteBtn: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
    deleteText: { color: c.dangerText, fontSize: typeScale.body },
    addRow: { flexDirection: 'row-reverse', gap: space.sm, marginTop: space.md, marginBottom: space.xs, alignItems: 'center' },
    addInput: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, color: c.text, paddingHorizontal: space.lg, paddingVertical: space.sm, fontSize: typeScale.body, minHeight: MIN_TOUCH },
    addBtn: { width: MIN_TOUCH, paddingHorizontal: 0 },
    btnBusy: { opacity: 0.6 },
  });
}
