import ArchiveSheet, { type ReassignItem, type ReassignTarget } from '@/components/ArchiveSheet';
import ArchivedList from '@/components/ArchivedList';
import CategoryIconPicker from '@/components/CategoryIconPicker';
import ListEmptyState from '@/components/ListEmptyState';
import BackButton from '@/components/BackButton';
import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useChartColors } from '@/hooks/use-chart-colors';
import {
  categoryArchiveBlock, categoryDeleteConsequences, categoryHasHistory, categoryLinkSummary,
  categoryReferences, type ArchiveBlock,
} from '@/lib/archiving';
import { categoryIcon } from '@/lib/finance';
import { useBusy, useBusyKey } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** إدارة الفئات — اتنقلت من شاشة الإعدادات بنفس منطق الحفظ بالحرف */
export default function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    categories, transactions, debts, subscriptions, budgets,
    addCategory, updateCategory, deleteCategory, archiveCategory, restoreCategory,
  } = useData();
  const { categoryColors } = useChartColors();

  const [newCategory, setNewCategory] = useState('');
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{
    id: string; name: string; items: ReassignItem[]; targets: ReassignTarget[]; note?: string;
  } | null>(null);

  const { busy: adding, run: runAdd } = useBusy();
  const { busyKey: deletingKey, run: runDelete } = useBusyKey();

  const activeCategories = useMemo(() => categories.filter(c => !c.archived), [categories]);
  const archivedCategories = useMemo(() => categories.filter(c => c.archived), [categories]);

  function refsFor(id: string) {
    return categoryReferences(id, { transactions, subscriptions, debts, budgets });
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
    if (!name || name === current) { clearNameDraft(id); return; }
    clearNameDraft(id);
    updateCategory(id, { name });
  }

  function showBlock(block: ArchiveBlock) {
    if (block.kind === 'last-active') {
      Alert.alert('دي آخر فئة شغالة',
        'لازم تفضل عندك فئة واحدة على الأقل عشان تصنّف مصاريفك. اعمل فئة تانية الأول.',
        [{ text: 'تمام' }]);
      return;
    }
    Alert.alert('مفيش فئة تانية',
      'الاشتراكات الشغالة محتاجة فئة تتنقل لها. اعمل فئة تانية الأول.',
      [{ text: 'تمام' }]);
  }

  function confirmDelete(id: string, name: string) {
    const refs = refsFor(id);
    if (!categoryHasHistory(refs)) {
      const budgetNote = refs.hasBudget ? ' وميزانيتها هتتمسح معاها.' : '';
      Alert.alert('حذف فئة', `متأكد إنك عايز تمسح "${name}"؟ مفيش أي عملية عليها.${budgetNote}`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'حذف', style: 'destructive', onPress: () => runDelete(id, () => deleteCategory(id)) },
      ]);
      return;
    }
    Alert.alert('الفئة دي عليها عمليات',
      `"${name}" عليها ${categoryLinkSummary(refs)}. لو مسحتها العمليات هتظهر باسم فئة ممسوحة. تقدر تأرشفها بدل كده.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => startArchive(id, name) },
        { text: 'امسحها برضه', style: 'destructive', onPress: () => confirmHardDelete(id, name) },
      ]);
  }

  function confirmHardDelete(id: string, name: string) {
    Alert.alert('مسح نهائي', categoryDeleteConsequences(refsFor(id)).join('\n'), [
      { text: 'ارجع', style: 'cancel' },
      { text: 'امسحها نهائي', style: 'destructive', onPress: () => runDelete(id, () => deleteCategory(id)) },
    ]);
  }

  function startArchive(id: string, name: string) {
    const refs = refsFor(id);
    const others = activeCategories.filter(x => x.id !== id);
    const block = categoryArchiveBlock({
      refs,
      activeCategoryCount: activeCategories.length,
      otherActiveCategoryCount: others.length,
    });
    if (block) { showBlock(block); return; }

    const budgetNote = refs.hasBudget ? ' ونمسح ميزانيتها الشهرية' : '';
    if (refs.activeSubscriptions.length === 0) {
      Alert.alert('أرشفة فئة', `هنأرشف "${name}"${budgetNote}. العمليات القديمة هتفضل زي ما هي.`, [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'أرشفها', onPress: () => archiveCategory(id, {}) },
      ]);
      return;
    }
    setSheet({
      id, name,
      items: refs.activeSubscriptions.map(x => ({ ...x, kind: 'اشتراك' })),
      targets: others.map(x => ({ id: x.id, name: x.name })),
      note: refs.hasBudget ? 'وهنمسح كمان ميزانيتها الشهرية.' : undefined,
    });
  }

  function confirmRestore(id: string, name: string) {
    Alert.alert('رجّع الفئة', `"${name}" هترجع من غير ميزانية، تقدر تحددلها ميزانية من جديد.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'رجّعها', onPress: () => restoreCategory(id) },
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
          <Text style={styles.title}>الفئات</Text>
        </View>
        <Text style={styles.hint}>تقدر تدوس على اسم الفئة تعدله مباشرة</Text>

        {activeCategories.length === 0 && (
          <ListEmptyState testID="categories_empty" message="لسه مفيش فئات شغالة. اعمل واحدة من تحت." />
        )}

        {activeCategories.map(c => (
          <View key={c.id} testID={`category_row_${c.id}`} style={styles.catRow}>
            {/* اللون كان مجرد نقطة مش بتتدوس. بقى خلفية للأيقونة، والدوسة
                بتفتح الاختيار — فمفيش صف زيادة ومفيش زرار تالت على الصف */}
            <TouchableOpacity
              testID={`category_icon_${c.id}`}
              onPress={() => setIconFor(c.id)}
              style={[styles.iconBtn, { backgroundColor: categoryColors.get(c.id) }]}>
              <Text style={styles.iconText}>{categoryIcon(c)}</Text>
            </TouchableOpacity>
            <TextInput
              testID={`category_name_input_${c.id}`}
              style={styles.nameInput}
              value={nameDrafts[c.id] !== undefined ? nameDrafts[c.id] : c.name}
              onChangeText={v => setNameDrafts(d => ({ ...d, [c.id]: v }))}
              onBlur={() => saveName(c.id, c.name)}
              textAlign="right"
            />
            <TouchableOpacity testID={`category_delete_${c.id}`} onPress={() => confirmDelete(c.id, c.name)} disabled={deletingKey === c.id}>
              <Text style={[styles.deleteText, deletingKey === c.id && styles.btnBusy]}>
                {deletingKey === c.id ? '...' : 'حذف'}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={styles.addRow}>
          <TextInput testID="category_add_input" style={styles.addInput} placeholder="فئة جديدة" placeholderTextColor={colors.textSecondary}
            value={newCategory} onChangeText={setNewCategory} textAlign="right" />
          <TouchableOpacity
            testID="category_add_button"
            style={[styles.addBtn, adding && styles.btnBusy]}
            disabled={adding}
            onPress={() => {
              const name = newCategory.trim();
              if (!name) return;
              runAdd(async () => { await addCategory(name); setNewCategory(''); });
            }}>
            <Text style={styles.addBtnText}>{adding ? '...' : '+'}</Text>
          </TouchableOpacity>
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
            title="أرشفة فئة"
            intro={`قبل ما نأرشف "${sheet.name}" لازم الاشتراكات الشغالة دي تلاقي فئة تانية.`}
            items={sheet.items}
            targets={sheet.targets}
            targetLabel="الفئة الجديدة"
            note={sheet.note}
            confirmText="أرشفها"
            onConfirm={assignments => { archiveCategory(sheet.id, assignments); setSheet(null); }}
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
    iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    iconText: { fontSize: 17 },
    catRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.border },
    nameInput: { flex: 1, color: c.text, fontSize: 14, fontWeight: '500', textAlign: 'right', paddingVertical: 2 },
    deleteText: { color: c.danger, fontSize: 12.5 },
    addRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 10, marginBottom: 6, alignItems: 'center' },
    addInput: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, color: c.text, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
    addBtn: { backgroundColor: c.accent, borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    addBtnText: { color: c.onAccent, fontSize: 20, fontWeight: '700' },
    btnBusy: { opacity: 0.6 },
  });
}
