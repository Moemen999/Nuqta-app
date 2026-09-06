import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { currentMonth, fmt } from '@/lib/finance';
import { useBusy } from '@/lib/useBusy';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const BUCKET_META = [
  { key: 'needs', label: 'احتياجات' },
  { key: 'wants', label: 'رفاهيات' },
  { key: 'future', label: 'خطط مستقبلية' },
] as const;

export default function ShakhbataView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categories, transactions, shakhbataIncome, shakhbataPercents, updateCategory, setMonthlyIncome, setShakhbataPercents } = useData();

  const { busy: savingPercents, run: runSavePercents } = useBusy();

  const nowMonth = currentMonth();
  const [incomeDraft, setIncomeDraft] = useState<string | null>(null);
  const [percentDrafts, setPercentDrafts] = useState<{ needs: string; wants: string; future: string } | null>(null);

  const income = incomeDraft !== null ? Number(incomeDraft) || 0 : (shakhbataIncome[nowMonth] || 0);

  // الدخل كان بيتحفظ في onBlur بس. لكن التبديل بين "الميزانية" و"شخبطة" بيشيل
  // المكوّن من الشاشة على طول من غير ما يشغّل onBlur، فالرقم كان بيضيع قبل ما
  // يوصل لقاعدة البيانات. دلوقتي بنحفظ بعد ثانية من آخر حرف، وكمان بنحفظ أي
  // مسوّدة لسه ما اتحفظتش وقت ما المكوّن يتشال.
  const pendingIncome = useRef<{ month: string; value: number } | null>(null);

  function saveIncome(raw: string) {
    const value = Number(raw) || 0;
    pendingIncome.current = null;
    setMonthlyIncome(nowMonth, value);
  }

  function handleIncomeChange(raw: string) {
    setIncomeDraft(raw);
    pendingIncome.current = { month: nowMonth, value: Number(raw) || 0 };
  }

  function handleIncomeBlur() {
    if (incomeDraft === null) return;
    saveIncome(incomeDraft);
  }

  useEffect(() => {
    if (incomeDraft === null) return;
    const t = setTimeout(() => saveIncome(incomeDraft), 1000);
    return () => clearTimeout(t);
  }, [incomeDraft]);

  useEffect(() => {
    return () => {
      const pending = pendingIncome.current;
      if (pending) setMonthlyIncome(pending.month, pending.value);
    };
  }, []);

  const percents = percentDrafts
    ? {
        needs: Number(percentDrafts.needs) || 0,
        wants: Number(percentDrafts.wants) || 0,
        future: Number(percentDrafts.future) || 0,
      }
    : shakhbataPercents;
  const percentSum = percents.needs + percents.wants + percents.future;

  function startEditingPercents() {
    setPercentDrafts({
      needs: String(shakhbataPercents.needs),
      wants: String(shakhbataPercents.wants),
      future: String(shakhbataPercents.future),
    });
  }
  function savePercents() {
    if (!percentDrafts) return;
    runSavePercents(async () => {
      await setShakhbataPercents({
        needs: Number(percentDrafts.needs) || 0,
        wants: Number(percentDrafts.wants) || 0,
        future: Number(percentDrafts.future) || 0,
      });
      setPercentDrafts(null);
    });
  }

  const spendByBucket = useMemo(() => {
    const map = new Map<string, number>();
    BUCKET_META.forEach(b => {
      const ids = categories.filter(c => c.bucket === b.key).map(c => c.id);
      const total = transactions
        .filter(t => t.type === 'expense' && t.date.slice(0, 7) === nowMonth && ids.includes(t.categoryId || ''))
        .reduce((s, t) => s + t.amount, 0);
      map.set(b.key, total);
    });
    return map;
  }, [categories, transactions, nowMonth]);

  const unassigned = categories.filter(c => !c.bucket);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>شخبطة</Text>
      <Text style={styles.subtitle}>قسّم دخلك الشهري على حسب النسب اللي انت حددتها</Text>

      <Text style={styles.label}>دخل شهر {nowMonth}</Text>
      <TextInput
        style={styles.incomeInput}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        value={incomeDraft !== null ? incomeDraft : (shakhbataIncome[nowMonth] ? String(shakhbataIncome[nowMonth]) : '')}
        onChangeText={handleIncomeChange}
        onBlur={handleIncomeBlur}
        textAlign="right"
      />

      <View style={styles.percentHead}>
        {percentDrafts ? (
          <TouchableOpacity onPress={savePercents} disabled={savingPercents}>
            <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '700', opacity: savingPercents ? 0.6 : 1 }}>
              {savingPercents ? '...' : 'حفظ النسب'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={startEditingPercents}>
            <Text style={{ color: colors.accent, fontSize: 12.5, fontWeight: '700' }}>عدّل النسب</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.label}>نسبك الحالية</Text>
      </View>

      {percentDrafts ? (
        <View style={styles.percentEditRow}>
          {BUCKET_META.map(b => (
            <View key={b.key} style={{ flex: 1 }}>
              <Text style={styles.microLabel}>{b.label} %</Text>
              <TextInput
                style={styles.percentInput}
                keyboardType="numeric"
                value={percentDrafts[b.key]}
                onChangeText={v => setPercentDrafts(d => d ? { ...d, [b.key]: v } : d)}
                textAlign="center"
              />
            </View>
          ))}
        </View>
      ) : null}
      {percentDrafts && percentSum !== 100 && (
        <Text style={styles.warnText}>مجموع النسب دلوقتي {percentSum}% — يفضل الأفضل يكون المجموع 100%، بس تقدر تسيبه لو عايز كده فعلاً</Text>
      )}

      {income > 0 && (
        <View style={styles.bucketsWrap}>
          {BUCKET_META.map(b => {
            const pct = percents[b.key] / 100;
            const target = income * pct;
            const spend = spendByBucket.get(b.key) || 0;
            const usagePct = target > 0 ? Math.min(100, (spend / target) * 100) : 0;
            const color = usagePct >= 100 ? colors.danger : usagePct >= 80 ? colors.accent : colors.success;
            return (
              <View key={b.key} style={styles.bucketCard}>
                <View style={styles.bucketHead}>
                  <Text style={styles.bucketLabel}>{b.label} ({percents[b.key]}%)</Text>
                  <Text style={styles.bucketTarget}>{fmt(target)} ج.م</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${usagePct}%`, backgroundColor: color }]} />
                </View>
                <Text style={[styles.bucketSpend, { color }]}>
                  اتصرف: {fmt(spend)} {spend > target ? `(زيادة ${fmt(spend - target)})` : `(متبقي ${fmt(target - spend)})`}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <Text style={styles.sectionTitle}>صنّف فئاتك</Text>
      <Text style={styles.hint}>حدد كل فئة تبع أنهي قسم من التلاتة (دوس تاني عشان تشيل التصنيف)</Text>
      {categories.map(c => (
        <View key={c.id} style={styles.catRow}>
          <Text style={styles.catName}>{c.name}</Text>
          <View style={styles.catBtns}>
            {BUCKET_META.map(b => {
              const active = c.bucket === b.key;
              return (
                <TouchableOpacity
                  key={b.key}
                  onPress={() => updateCategory(c.id, { bucket: active ? '' : b.key })}
                  style={[
                    styles.catBtn,
                    { borderColor: active ? colors.accent : colors.borderStrong, backgroundColor: active ? colors.accent + '22' : 'transparent' },
                  ]}>
                  <Text style={{ color: active ? colors.text : colors.textSecondary, fontSize: 11 }}>{b.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {unassigned.length > 0 && income > 0 && (
        <Text style={styles.warnText}>
          فيه {unassigned.length} فئة لسه من غير تصنيف، مصاريفها مش هتتحسب في أي قسم فوق
        </Text>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    title: { color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'right' },
    subtitle: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 4, marginBottom: 16, lineHeight: 18 },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginBottom: 6 },
    incomeInput: {
      backgroundColor: c.surface2, borderWidth: 1.5, borderColor: c.accent, borderRadius: 10,
      color: c.text, fontSize: 20, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
    },
    percentHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
    percentEditRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 8 },
    microLabel: { color: c.textMuted, fontSize: 10.5, textAlign: 'center', marginBottom: 4 },
    percentInput: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, color: c.text, paddingVertical: 8, fontSize: 14, fontWeight: '700' },
    warnText: { color: c.accent, fontSize: 11.5, textAlign: 'right', marginTop: 8, lineHeight: 17 },
    bucketsWrap: { marginTop: 16, marginBottom: 10 },
    bucketCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, marginBottom: 10 },
    bucketHead: { flexDirection: 'row-reverse', justifyContent: 'space-between' },
    bucketLabel: { color: c.text, fontSize: 14, fontWeight: '700' },
    bucketTarget: { color: c.textSecondary, fontSize: 13 },
    track: { height: 6, backgroundColor: c.surface2, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3 },
    bucketSpend: { fontSize: 12, marginTop: 6, textAlign: 'right' },
    sectionTitle: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'right', marginTop: 16, marginBottom: 4 },
    hint: { color: c.textMuted, fontSize: 11, textAlign: 'right', marginBottom: 10, lineHeight: 16 },
    catRow: { backgroundColor: c.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    catName: { color: c.text, fontSize: 13.5, fontWeight: '500', textAlign: 'right', marginBottom: 8 },
    catBtns: { flexDirection: 'row-reverse', gap: 6 },
    catBtn: { flex: 1, borderWidth: 1.5, borderRadius: 8, alignItems: 'center', paddingVertical: 7 },
  });
}