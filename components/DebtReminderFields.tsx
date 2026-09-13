import CalendarPickerModal from '@/components/CalendarPickerModal';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionStyle, selectionTextColor } from '@/lib/selection';
import { MIN_TOUCH } from '@/lib/tokens';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
        <TouchableOpacity style={styles.dateBtn} onPress={() => setShowPicker(true)}>
          <Text style={styles.dateBtnText}>{dueDate || 'من غير معاد'}</Text>
        </TouchableOpacity>
        {!!dueDate && (
          <TouchableOpacity
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
            <TouchableOpacity
              onPress={() => onChangeReminder(null)}
              style={[styles.chip, selectionStyle(colors, reminderDaysBefore === null)]}>
              <Text style={{ color: selectionTextColor(colors, reminderDaysBefore === null), fontSize: 13 }}>من غير تذكير</Text>
            </TouchableOpacity>
            {DAYS_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.days}
                onPress={() => onChangeReminder(opt.days)}
                style={[styles.chip, selectionStyle(colors, reminderDaysBefore === opt.days)]}>
                <Text style={{ color: selectionTextColor(colors, reminderDaysBefore === opt.days), fontSize: 13 }}>{opt.label}</Text>
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
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 14, marginBottom: 6 },
    row: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center' },
    dateBtn: { flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
    dateBtnText: { color: c.text, fontSize: 14, textAlign: 'center' },
    clearBtn: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 10 },
    clearText: { color: c.danger, fontSize: 12, fontWeight: '700' },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    hintText: { color: c.textSecondary, fontSize: 11.5, textAlign: 'right', marginTop: 8, lineHeight: 16 },
  });
}
