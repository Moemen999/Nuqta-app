import { plainAmount } from '@/lib/money';
import { Money } from '@/components/Money';
import { usePrivacy } from '@/context/PrivacyContext';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { type BalanceProjection } from '@/lib/finance';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { typeScale } from '@/lib/tokens';

/**
 * سطر صغير تحت خانة المبلغ: الرقم بفواصل، والرصيد رايح فين لو حفظت.
 *
 * ده **مش** تحقق. التطبيق مش عارف المستخدم بيصرف قد إيه، فأي سقف هنخترعه
 * هيبقى رقم بندافع عنه من غير سند. اللي بنعمله إن الرقم يبقى مقروء قبل
 * الحفظ: 50000 و500 شكلهم قريب في خانة فاضية، لكن الرصيد وهو بيتحوّل من
 * 4,500 لـ -45,500 بيبان غلط على طول.
 *
 * مفيش لون تحذير على الرصيد السالب: الرصيد بالسالب حالة شرعية هنا (تسجيل
 * بترتيب مش زمني، محفظة بحد ائتماني)، والتطبيق نفسه مش بيلوّن أي رصيد حسب
 * إشارته (شوف index.tsx). وكمان اللون مش هو اللي بيمسك الغلط أصلاً — غلطة
 * حجم في محفظة كبيرة بتفضل موجبة، فلون على السالب بس هيعلّم المستخدم إن
 * "مفيش أحمر يبقى تمام" وده مش صحيح.
 */
export default function AmountPreview({ amount, value, projections }: {
  amount: string;
  /**
   * المبلغ زي ما هيتخزّن (مودال العملية: `parseTxAmountInput` — الميزة 8). موجود ← هو اللي بيتعرض بدل `Number(amount)`،
   * فـ«٢٠٠» و«1,500» بيبانوا، واللي بيتعرض = اللي بيتحفظ. `null` = مش مبلغ (مفيش صدى)
   */
  value?: number | null;
  projections: BalanceProjection[];
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const num = value !== undefined ? (value ?? NaN) : Number(amount);
  const showAmount = (value !== undefined || amount.trim() !== '') && isFinite(num) && num > 0;
  if (!showAmount && projections.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {/* الرقم اللي بيتكتب دلوقتي — استثناء الإخفاء: ده صدى الخانة نفسها */}
      {showAmount && <Text style={styles.amountText}>{plainAmount(num)} ج.م</Text>}
      {/* كل صف عقدة واحدة لقارئ الشاشة (الميزة 8): قبل كده الاسم و«من» والرقمين كانوا 4 محطات من غير «جنيه» */}
      {projections.map(p => <PreviewRow key={p.walletId} p={p} styles={styles} />)}
    </View>
  );
}

/** صف لوحده عشان `usePrivacy` يتنادى بس لما فيه صف — زي `Money` (شاشات من غير PrivacyProvider في الاختبارات) */
function PreviewRow({ p, styles }: { p: BalanceProjection; styles: ReturnType<typeof makeStyles> }) {
  const { amountsHidden, money } = usePrivacy();
  return (
    <View style={styles.row} accessible
      accessibilityLabel={amountsHidden ? `${p.name}، رصيد مخفي` : `${p.name}، من ${money(p.before)} إلى ${money(p.after)} جنيه`}>
      <Text style={styles.walletName}>{p.name}</Text>
      <Text style={styles.balanceText}>من <Money value={p.before} currency={false} /> إلى <Money value={p.after} currency={false} /></Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 6, gap: 2 },
  amountText: { color: c.textSecondary, fontSize: typeScale.body, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  walletName: { color: c.textSecondary, fontSize: typeScale.caption },
  balanceText: { color: c.textSecondary, fontSize: typeScale.caption },
});
