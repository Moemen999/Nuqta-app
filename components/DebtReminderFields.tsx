import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { dateText } from '@/lib/dateText';
import { todayStr } from '@/lib/finance';
import { selectionA11y, selectionStyle, selectionTextColor } from '@/lib/selection';
import { MIN_TOUCH, typeScale, space, radius } from '@/lib/tokens';
import { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

/** الاختيارات الجاهزة للتذكير — بالأيام قبل المعاد */
const DAYS_OPTIONS = [
  { days: 0, label: 'يوم المعاد' },
  { days: 1, label: 'بيوم' },
  { days: 3, label: 'بـ 3 أيام' },
  { days: 7, label: 'بأسبوع' },
];

/**
 * معاد الدين وتذكيره — نفس الحقول في فورم "دين جديد" وفورم "تعديل البيانات".
 *
 * التذكير ده إشعار **ليك إنت**، مش رسالة بتتبعت للشخص التاني — والنص في
 * الشاشة بيقول كده صريح عشان محدش يفتكر إن التطبيق بيكلّم حد.
 */
export default function DebtReminderFields({
  dueDate, reminderDaysBefore, onChangeDueDate, onChangeReminder,
}: {
  dueDate: string;
  reminderDaysBefore: number | null;
  onChangeDueDate: (v: string) => void;
  onChangeReminder: (v: number | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showPicker, setShowPicker] = useState(false);

  return (
    <>
      <Text style={styles.label}>معاد الدين (اختياري)</Text>
      <View style={styles.row}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`معاد الدين، ${dueDate ? dateText(dueDate, todayStr()) : 'من غير معاد'}`} style={styles.dateBtn} onPress={() => setShowPicker(true)}>
          <Text style={styles.dateBtnText}>{dueDate ? dateText(dueDate, todayStr()) : 'من غير معاد'}</Text>
        </TouchableOpacity>
        {!!dueDate && (
          <TouchableOpacity accessibilityRole="button"
            style={styles.clearBtn}
            onPress={() => { onChangeDueDate(''); onChangeReminder(null); }}
            hitSlop={8}>
            <Text style={styles.clearText}>شيل المعاد</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!dueDate && (
        <>
          <Text style={styles.label}>فكّرني قبله</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity {...selectionA11y(reminderDaysBefore === null, 'radio')}
              onPress={() => onChangeReminder(null)}
              style={[styles.chip, selectionStyle(colors, reminderDaysBefore === null)]}>
              <Text style={{ color: selectionTextColor(colors, reminderDaysBefore === null), fontSize: typeScale.body }}>من غير تذكير</Text>
            </TouchableOpacity>
            {DAYS_OPTIONS.map(opt => (
              <TouchableOpacity {...selectionA11y(reminderDaysBefore === opt.days, 'radio')}
                key={opt.days}
                onPress={() => onChangeReminder(opt.days)}
                style={[styles.chip, selectionStyle(colors, reminderDaysBefore === opt.days)]}>
                <Text style={{ color: selectionTextColor(colors, reminderDaysBefore === opt.days), fontSize: typeScale.body }}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {reminderDaysBefore !== null && (
            <Text style={styles.hintText}>
              هيوصلك إشعار على موبايلك إنت — التطبيق مبيبعتش أي حاجة للشخص التاني.
              ولازم الإشعارات تكون مفعّلة من الإعدادات.
            </Text>
          )}
        </>
      )}

      <CalendarPickerModal
        visible={showPicker}
        value={dueDate}
        onSelect={onChangeDueDate}
        onClose={() => setShowPicker(false)}
      />
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xl, marginBottom: space.xs },
    row: { flexDirection: 'row-reverse', gap: space.sm, alignItems: 'center' },
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: radius.md, paddingHorizontal: space.xl, paddingVertical: space.lg },
    dateBtnText: { color: c.text, fontSize: typeScale.body, textAlign: 'center' },
    clearBtn: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: space.md },
    clearText: { color: c.dangerText, fontSize: typeScale.caption, fontWeight: '700' },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: MIN_TOUCH, justifyContent: 'center' },
    hintText: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.sm, lineHeight: 17 },
  });
}
