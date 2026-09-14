import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { fmt, type BalanceProjection } from '@/lib/finance';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
export default function AmountPreview({ amount, projections }: { amount: string; projections: BalanceProjection[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const num = Number(amount);
  const showAmount = amount.trim() !== '' && isFinite(num) && num > 0;
  if (!showAmount && projections.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {showAmount && <Text style={styles.amountText}>{fmt(num)} ج.م</Text>}
      {projections.map(p => (
        <View key={p.walletId} style={styles.row}>
          <Text style={styles.walletName}>{p.name}</Text>
          <Text style={styles.balanceText}>{fmt(p.before)} ← {fmt(p.after)}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 6, gap: 2 },
  amountText: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  walletName: { color: c.textSecondary, fontSize: 12 },
  balanceText: { color: c.textSecondary, fontSize: 12 },
});
