import { useData } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionStyle } from '@/lib/selection';
import {
  categoryLabel, currentMonth, fmt, parsePercentInput, percentInvalidBody, percentInvalidTitle,
  planIncomeCommit,
} from '@/lib/finance';
import { useAmountDrafts } from '@/lib/useAmountDrafts';
import { useBusy } from '@/lib/useBusy';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const BUCKET_META = [
  { key: 'needs', label: 'احتياجات' },
  { key: 'wants', label: 'رفاهيات' },
  { key: 'future', label: 'خطط مستقبلية' },
] as const;

export default function ShakhbataView() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { categories: allCategories, transactions, shakhbataIncome, shakhbataPercents, updateCategory, setMonthlyIncome, setShakhbataPercents } = useData();
  // المؤرشفة مش بتتوزّع على الدلاء — هي مش جزء من خطة الشهر الجاي
  const categories = useMemo(() => allCategories.filter(c => !c.archived), [allCategories]);

  const { busy: savingPercents, run: runSavePercents } = useBusy();

  const nowMonth = currentMonth();
  const [percentDrafts, setPercentDrafts] = useState<{ needs: string; wants: string; future: string } | null>(null);

  // الدخل كان `Number(raw) || 0` مع حفظ تلقائي بعد ثانية **من غير ما يستنى
  // الخروج من الخانة** — يعني نص رقم أو لصقة غلط كانت بتتكتب صفر في
  // فايربيز لوحدها، وكل أهداف الشهر تتصفّر من غير أي رسالة. نفس الباگ
  // اللي اتصلح في المحافظ، عاش هنا لأن الكود كان متكرر. دلوقتي نفس الهوك
  // بنفس القواعد: الكلام اللي مش رقم مترفوض والخانة بترجع للمحفوظ.
  const incomeDrafts = useAmountDrafts(
    month => shakhbataIncome[month] || 0,
    (month, value) => setMonthlyIncome(month, value),
    { plan: planIncomeCommit, blankWhenZero: true },
  );
  const income = incomeDrafts.numberFor(nowMonth, shakhbataIncome[nowMonth] || 0);

  // المعاينة وانت بتعدّل: النسبة الغلط بتوري المحفوظ، مش صفر
  const percents = useMemo(() => {
    if (!percentDrafts) return shakhbataPercents;
    const pick = (k: 'needs' | 'wants' | 'future') => {
      const v = parsePercentInput(percentDrafts[k]);
      return v === null ? shakhbataPercents[k] : v;
    };
    return { needs: pick('needs'), wants: pick('wants'), future: pick('future') };
  }, [percentDrafts, shakhbataPercents]);
  const percentSum = percents.needs + percents.wants + percents.future;

  function startEditingPercents() {
    setPercentDrafts({
      needs: String(shakhbataPercents.needs),
      wants: String(shakhbataPercents.wants),
      future: String(shakhbataPercents.future),
    });
  }

  /**
   * النسب ليها زرار حفظ صريح (مش حفظ تلقائي زي الدخل)، فالتحقق بيحصل هنا
   * مرة واحدة على التلاتة: أي واحدة برّه 0-100 بتوقف الحفظ كله وتتسمّى
   * بالاسم. المجموع لسه تحذير ناعم — شوف `parsePercentInput`.
   *
   * **ومفيش `onBlur` بيصلّح الخانة لوحده.** جربنا كده وطلع بيبلع الرسالة:
   * في React Native الضغط على "حفظ النسب" بيعمل blur للخانة الأول، فالخانة
   * كانت بترجع للمحفوظ بصمت قبل ما التحقق ده يشتغل أصلاً — فالمستخدم يشوف
   * رقمه بيختفي من غير ما حد يقوله إيه الغلط. دلوقتي الرقم بيفضل قدامه
   * لحد ما الرسالة تقوله بالاسم إيه اللي مش مظبوط.
   */
  function savePercents() {
    if (!percentDrafts) return;
    const parsed = {
      needs: parsePercentInput(percentDrafts.needs),
      wants: parsePercentInput(percentDrafts.wants),
      future: parsePercentInput(percentDrafts.future),
    };
    const bad = BUCKET_META.filter(b => parsed[b.key] === null).map(b => b.label);
    if (bad.length > 0) {
      Alert.alert(percentInvalidTitle(bad.length), percentInvalidBody(bad));
      return;
    }
    runSavePercents(async () => {
      await setShakhbataPercents({
        needs: parsed.needs as number,
        wants: parsed.wants as number,
        future: parsed.future as number,
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={styles.title}>شخبطة</Text>
      <Text style={styles.subtitle}>قسّم دخلك الشهري على حسب النسب اللي انت حددتها</Text>

      <Text style={styles.label}>دخل شهر {nowMonth}</Text>
      <TextInput
        style={styles.incomeInput}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        value={incomeDrafts.valueFor(nowMonth, shakhbataIncome[nowMonth] || 0)}
        onChangeText={v => incomeDrafts.onChange(nowMonth, v)}
        onBlur={() => incomeDrafts.onBlur(nowMonth)}
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
          <Text numberOfLines={1} ellipsizeMode="middle" style={styles.catName}>{categoryLabel(c)}</Text>
          <View style={styles.catBtns}>
            {BUCKET_META.map(b => {
              const active = c.bucket === b.key;
              return (
                <TouchableOpacity
                  key={b.key}
                  onPress={() => updateCategory(c.id, { bucket: active ? '' : b.key })}
                  style={[styles.catBtn, selectionStyle(colors, active)]}>
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