import { useTheme } from '@/context/ThemeContext';
import { CHARGE_MODE_LABEL, type ChargeMode } from '@/lib/autoCharge';
import { selectionStyle } from '@/lib/selection';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/**
 * "بتأكيد" (الافتراضي — أي حاجة بتخصم فلوس) أو "تلقائي". نفس شكل اختيار
 * الدخل الثابت (`IncomesView`). `what`: "الاشتراك" / "القسط".
 */
export default function ChargeModePicker({ value, onChange, what, verb, testIDPrefix }: {
  value: ChargeMode; onChange: (m: ChargeMode) => void; what: string;
  /** نفس الكلمة اللي على الكارت: "اتخصم" للاشتراك، "اتدفع" للقسط */
  verb: string; testIDPrefix: string;
}) {
  const { colors } = useTheme();
  return (
    // radiogroup بنفس السؤال اللي ظاهر: قارئ الشاشة بيقول إن الاختيارين واحد من اتنين
    <View accessibilityRole="radiogroup" accessibilityLabel={`لما معاد ${what} ييجي`}>
      <Text style={[styles.label, { color: colors.textSecondary }]} accessible={false}>{`لما معاد ${what} ييجي`}</Text>
      {(['confirm', 'auto'] as const).map(m => (
        <TouchableOpacity key={m} testID={`${testIDPrefix}_mode_${m}`} onPress={() => onChange(m)}
          accessibilityRole="radio" accessibilityState={{ selected: value === m }}
          style={[styles.card, selectionStyle(colors, value === m)]}>
          <Text style={[styles.title, { color: colors.text }]}>{CHARGE_MODE_LABEL[m]}{m === 'confirm' ? ' (مقترح)' : ''}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {m === 'confirm'
              ? `هيظهرلك كارت في الرئيسية: "${verb}؟" — تأكد أو تعدّل المبلغ. مفيش حاجة بتتسجل من غيرك.`
              : `أول ما تفتح التطبيق بعد المعاد هيتسجل، وهيجيلك إشعار إنه اتسجل عشان لو الرقم مختلف تعدّله. بيبدأ من المعاد الجاي — اللي فات بيسألك.`}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
  card: { borderWidth: 1.5, borderRadius: 12, padding: 14, marginTop: 12 },
  title: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  body: { fontSize: 12, textAlign: 'right', marginTop: 4, lineHeight: 18 },
});
