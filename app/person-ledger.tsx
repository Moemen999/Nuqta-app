import { Money } from '@/components/Money';
import { usePrivacy } from '@/context/PrivacyContext';
import BackButton from '@/components/BackButton';
import { AddDebtModal, DebtIncreaseModal, DebtPaymentModal } from '@/components/DebtEntryModals';
import { useData, type Debt } from '@/context/DataContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { debtGrandTotal, debtPaid, findPersonGroup } from '@/lib/finance';
import { MIN_TOUCH, radius, space, typeScale } from '@/lib/tokens';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Row = {
  date: string;
  label: string;
  delta: number; // موجب = زوّد رصيدك عنده، سالب = قلل
  /** الدين اللي الحركة دي منه — الصفحة بتجمّع كذا دين لنفس الشخص */
  debtLabel: string;
};

/** وصف قصير يفرّق الدين عن باقي ديون نفس الشخص */
function debtLabelOf(d: Debt) {
  const side = d.direction === 'owed_to_me' ? 'ليا' : 'عليا';
  const when = d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '');
  return d.note?.trim() ? `${side} · ${d.note.trim()}` : `${side} · ${when}`;
}

export default function PersonLedgerScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // personKey جاي من groupDebtsByPerson — مش الاسم، عشان نفس الشخص ميتقسمش
  // لو اسمه مكتوب بمسافة زايدة أو اتعدّل في دين من ديونه
  const { personKey } = useLocalSearchParams<{ personKey?: string }>();
  const { debts } = useData();
  const { money } = usePrivacy();

  const group = useMemo(() => (personKey ? findPersonGroup(debts, personKey) : undefined), [debts, personKey]);
  const personName = group?.displayName || '';

  const [paymentForDebt, setPaymentForDebt] = useState<Debt | null>(null);
  const [increaseForDebt, setIncreaseForDebt] = useState<Debt | null>(null);
  const [showAddDebt, setShowAddDebt] = useState(false);

  /**
   * الصفحة بتجمّع كذا دين لنفس الشخص، فسؤال "الدفعة دي على أنهي دين؟" مالوش
   * إجابة تلقائية — أي اختيار من عندنا (الأقدم؟ الأكبر؟ بالتوزيع؟) بيبقى
   * سياسة محاسبية المستخدم ما اختارهاش. فالأزرار بتبقى **لكل دين لوحده**،
   * والمستخدم هو اللي بيحدد بالدوس. الاستثناء المريح: لو فيه دين واحد مفتوح
   * بس، الزرار الرئيسي بيشتغل عليه على طول وبيقول اسمه — الحالة الشايعة
   * بتبقى دوسة واحدة وبرضه من غير أي تخمين.
   */
  const openDebts = useMemo(
    () => (group?.debts || []).filter(d => debtGrandTotal(d) - debtPaid(d) > 0.001),
    [group]
  );
  const soleOpenDebt = openDebts.length === 1 ? openDebts[0] : null;

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    (group?.debts || []).forEach((d: Debt) => {
      const sign = d.direction === 'owed_to_me' ? 1 : -1;
      const initDate = d.date || (d.createdAt ? d.createdAt.slice(0, 10) : '');
      const debtLabel = debtLabelOf(d);
      list.push({
        date: initDate,
        label: d.direction === 'owed_to_me' ? 'دين جديد (أنت اداه)' : 'دين جديد (هو اداك)',
        delta: sign * d.totalAmount,
        debtLabel,
      });
      (d.increases || []).forEach(inc => {
        list.push({
          date: inc.date,
          label: d.direction === 'owed_to_me' ? 'زيادة (أنت اداه)' : 'زيادة (هو اداك)',
          delta: sign * inc.amount,
          debtLabel,
        });
      });
      d.payments.forEach(p => {
        list.push({
          date: p.date,
          label: d.direction === 'owed_to_me' ? 'سداد (هو دفعلك)' : 'سداد (أنت دفعتله)',
          delta: -sign * p.amount,
          debtLabel,
        });
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [group]);

  let running = 0;
  const rowsWithBalance = rows.map(r => {
    running += r.delta;
    return { ...r, balance: running };
  });

  const finalBalance = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1].balance : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag">
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title}>{personName ? `كشف حساب — ${personName}` : 'كشف حساب'}</Text>
      </View>

      {!group ? (
        <Text style={styles.emptyState}>الشخص ده مبقى لوش ديون — يمكن اتمسحت.</Text>
      ) : (
      <>
      <View style={styles.summaryCard}>
        {/* دراسة الشكل خطوة 5: الرصيد الحالي هو البطل — الاتجاه بالكلمة فوقه، والرقم 34 */}
        <Text style={styles.summaryLabel}>{finalBalance > 0 ? 'ليك عنده' : finalBalance < 0 ? 'عليك له' : 'الرصيد الحالي'}</Text>
        {finalBalance === 0
          ? <Text style={[styles.summaryValue, { color: colors.textSecondary }]}>متسدد بالكامل</Text>
          : <Money value={Math.abs(finalBalance)} fit style={[styles.summaryHero, { color: finalBalance > 0 ? colors.incomeText : colors.dangerText }]} />}
      </View>

      {/* قايمة مش جدول (دراسة الشكل): 4 عواميد بخط 10–12 على عرض موبايل ← البيان والتاريخ يمين، الحركة والرصيد شمال */}
      <Text style={[styles.sectionTitle, { marginTop: 0 }]}>الحركات</Text>
      {/* تفسير العلامات قبل القايمة مش بعدها (القايمة ممكن تطول) — ومبيظهرش من غير حركات */}
      {rowsWithBalance.length > 0 && <Text style={styles.hintText}>موجب (+) = ليك عنده أكتر · سالب (−) = عليك له أكتر</Text>}
      {rowsWithBalance.length === 0 && <Text style={styles.emptyState}>مفيش حركات لسه</Text>}
      {rowsWithBalance.length > 0 && (
        <View style={styles.listCard}>
          {rowsWithBalance.map((r, i) => (
            <View key={i} testID={`ledger_row_${i}`} style={[styles.listRow, i > 0 && styles.listDivider]}>
              <View style={styles.listMain}>
                <Text style={styles.listLabel}>{r.label}</Text>
                {/* التاريخ لوحده: الملاحظة الطويلة كانت بتقصّه من آخر السطر */}
                <Text style={styles.listSub} numberOfLines={1}>{r.debtLabel}</Text>
                <Text style={styles.listSub}>{r.date}</Text>
              </View>
              <View style={styles.listSide}>
                {/* العلامة صريحة للاتنين ("−" مش من fmt): مع قناع الخصوصية السالب كان بيبان "••••" من غير علامة */}
                <Money value={Math.abs(r.delta)} sign={r.delta >= 0 ? '+' : '−'} currency={false}
                  style={[styles.listDelta, { color: r.delta >= 0 ? colors.incomeText : colors.dangerText }]} />
                <View style={styles.balanceRow}>
                  <Text style={styles.listSub}>الرصيد</Text>
                  <Money value={Math.abs(r.balance)} sign={r.balance < 0 ? '−' : ''} currency={false} style={styles.listSub} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}


      <View style={styles.sectionTitleRow}>
        {/* من غير اتجاه مقفول هنا — الصفحة دي بتجمّع اتجاهين ممكنين لنفس
            الشخص، فمفيش اتجاه "عكسي" واحد نحدده تلقائي زي كارت الدين */}
        <TouchableOpacity accessibilityRole="button" style={styles.addDebtBtn} onPress={() => setShowAddDebt(true)}>
          <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>+ دين جديد</Text>
        </TouchableOpacity>
        <Text style={[styles.sectionTitle, { marginTop: 0 }]}>سجّل حركة</Text>
      </View>
      {soleOpenDebt ? (
        <>
          <Text style={styles.hintText}>دين واحد مفتوح بس، فالحركة هتتسجل عليه</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity accessibilityRole="button" style={styles.payBtn} onPress={() => setPaymentForDebt(soleOpenDebt)}>
              <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>
                تسجيل دفعة على: {debtLabelOf(soleOpenDebt)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setIncreaseForDebt(soleOpenDebt)}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>زيادة</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.hintText}>
            {openDebts.length === 0
              ? 'مفيش دين مفتوح دلوقتي — كل حاجة متسددة. الزيادة بتتسجل من الالتزامات ← الديون.'
              : 'اختار الدين اللي الحركة عليه — الصفحة دي فيها أكتر من دين لنفس الشخص.'}
          </Text>
          {openDebts.map(d => {
            const remaining = debtGrandTotal(d) - debtPaid(d);
            return (
              <View key={d.id} style={styles.debtBlock}>
                <View style={styles.debtBlockHead}>
                  <Text style={styles.debtBlockTitle}>{debtLabelOf(d)}</Text>
                  <Text style={[styles.debtBlockRemaining, { color: d.direction === 'owed_to_me' ? colors.incomeText : colors.dangerText }]}>
                    متبقي <Money value={remaining} />
                  </Text>
                </View>
                <View style={styles.actionsRow}>
                  <TouchableOpacity accessibilityRole="button" style={styles.payBtn} onPress={() => setPaymentForDebt(d)}>
                    <Text style={{ color: colors.onAccent, fontWeight: '700', fontSize: 12.5 }}>تسجيل دفعة</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" style={styles.secondaryBtn} onPress={() => setIncreaseForDebt(d)}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>زيادة</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </>
      )}

      {paymentForDebt && <DebtPaymentModal debt={paymentForDebt} onClose={() => setPaymentForDebt(null)} />}
      {increaseForDebt && <DebtIncreaseModal debt={increaseForDebt} onClose={() => setIncreaseForDebt(null)} />}
      {showAddDebt && (
        <AddDebtModal
          onClose={() => setShowAddDebt(false)}
          prefill={{ personName, personContactId: group?.personContactId }}
        />
      )}
      </>
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: space.xxl, paddingBottom: space.huge * 2 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    title: { color: c.text, fontSize: typeScale.title, fontWeight: '700' },
    summaryCard: { backgroundColor: c.surface, borderRadius: radius.xl, padding: space.xxxl, alignItems: 'center', marginBottom: space.xxl },
    summaryLabel: { color: c.textSecondary, fontSize: typeScale.body },
    summaryValue: { fontSize: typeScale.title, fontWeight: '700', marginTop: space.xs },
    summaryHero: { fontSize: typeScale.hero, fontWeight: '700', marginTop: space.xxs },
    listCard: { backgroundColor: c.surface, borderRadius: radius.xl, paddingHorizontal: space.xxl },
    listRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: MIN_TOUCH },
    listDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    listMain: { flex: 1 },
    listLabel: { color: c.text, fontSize: typeScale.body, textAlign: 'right' },
    listSide: { alignItems: 'flex-end' },
    balanceRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: space.xxs },
    listDelta: { fontSize: typeScale.body, fontWeight: '700' },
    listSub: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: 2 },
    emptyState: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'center', paddingVertical: space.xxxl },
    sectionTitle: { color: c.text, fontSize: typeScale.title, fontWeight: '700', textAlign: 'right', marginTop: 24, marginBottom: 6 },
    sectionTitleRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 6 },
    addDebtBtn: { backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    hintText: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginBottom: 10, lineHeight: 17 },
    debtBlock: { backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border, marginBottom: 10 },
    debtBlockHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 },
    debtBlockTitle: { color: c.text, fontSize: 13, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
    debtBlockRemaining: { fontSize: 12.5, fontWeight: '700' },
    actionsRow: { flexDirection: 'row-reverse', gap: 8, flexWrap: 'wrap' },
    payBtn: { flexShrink: 1, minHeight: MIN_TOUCH, justifyContent: 'center', backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 14 },
    secondaryBtn: { minHeight: MIN_TOUCH, justifyContent: 'center', borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14 },
  });
}