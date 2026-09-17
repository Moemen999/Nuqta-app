import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionStyle } from '@/lib/selection';
import { overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type ReassignTarget = { id: string; name: string };
/** حاجة شغّالة مربوطة باللي بنأرشفه ولازم تلاقي بديل قبل ما نكمّل */
export type ReassignItem = { id: string; name: string; kind: string };

type Props = {
  title: string;
  /** سطر بيشرح ليه إحنا هنا */
  intro: string;
  items: ReassignItem[];
  targets: ReassignTarget[];
  /** عنوان صف الاختيار — "المحفظة الجديدة" ولا "الفئة الجديدة" */
  targetLabel: string;
  /** تحذير إضافي تحت القايمة (زي مسح الميزانية) */
  note?: string;
  confirmText: string;
  busy?: boolean;
  onConfirm: (assignments: Record<string, string>) => void;
  onClose: () => void;
};

/**
 * شيت الأرشفة: بينقل الحاجات الشغّالة لمكان تاني **وبعدين** يأرشف، في خطوة
 * واحدة.
 *
 * ليه شيت مش `Alert.alert`: الرسالة "غيّر محفظتهم الأول" كانت بتسيب
 * المستخدم يدوّر بنفسه على كل اشتراك وكل جمعية ويعدّلهم واحد واحد وبعدين
 * يرجع يأرشف. الاختيار لازم يبقى في نفس المكان اللي فيه القرار.
 *
 * زرار الأرشفة مقفول لحد ما كل حاجة تلاقي بديل — أرشفة بنص نقل معناها
 * اشتراك شغّال مربوط بمحفظة مؤرشفة، يعني تسديد بيترفض كل شهر.
 *
 * مفيش `TextInput` هنا خالص، فمفيش كيبورد يغطي حاجة. بس الزراير في فوتر
 * لاصق برّه الـ`ScrollView` زي باقي المودالات، عشان تفضل باينة مهما طالت
 * قايمة الاشتراكات.
 */
export default function ArchiveSheet({
  title, intro, items, targets, targetLabel, note, confirmText, busy, onConfirm, onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const allAssigned = items.every(i => assignments[i.id]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle}>{title}</Text>
            <Text style={styles.intro}>{intro}</Text>

            {items.map(item => (
              <View key={item.id} style={styles.itemCard}>
                <Text style={styles.itemName}>{item.kind}: {item.name}</Text>
                <Text style={styles.label}>{targetLabel}</Text>
                <View style={styles.chipRow}>
                  {targets.map(t => (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => setAssignments(a => ({ ...a, [item.id]: t.id }))}
                      style={[styles.chip, selectionStyle(colors, assignments[item.id] === t.id)]}>
                      <Text style={{ color: colors.text, fontSize: 13 }}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}

            {!!note && <Text style={styles.note}>{note}</Text>}
            <Text style={styles.note}>العمليات القديمة والدفعات اللي اتسجلت خلاص مش هتتغير.</Text>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy}>
              <Text style={{ color: colors.textSecondary }}>إلغاء</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="archive_sheet_confirm"
              style={[styles.saveBtn, (!allAssigned || busy) && styles.btnBusy]}
              disabled={!allAssigned || busy}
              onPress={() => onConfirm(assignments)}>
              <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{busy ? '...' : confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: { ...sheetStyle(c, { maxHeight: '90%' }), padding: 0, overflow: 'hidden' },
    scrollArea: { flexShrink: 1 },
    sheetContent: { padding: 20 },
    sheetTitle: sheetTitleStyle(c, 4),
    intro: { color: c.textSecondary, fontSize: 12.5, textAlign: 'right', lineHeight: 19, marginTop: 6 },
    itemCard: { backgroundColor: c.surface2, borderRadius: 12, padding: 12, marginTop: 14, borderWidth: 1, borderColor: c.border },
    itemName: { color: c.text, fontSize: 13.5, fontWeight: '700', textAlign: 'right' },
    label: { color: c.textSecondary, fontSize: 12, textAlign: 'right', marginTop: 10, marginBottom: 6 },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    note: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 14, lineHeight: 17 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    saveBtn: { flex: 2, backgroundColor: c.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
    btnBusy: { opacity: 0.5 },
  });
}
