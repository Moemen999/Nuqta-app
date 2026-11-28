import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionA11y, selectionStyle } from '@/lib/selection';
import { MIN_TOUCH, overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle, radius, space, typeScale } from '@/lib/tokens';
import { useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Text } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';

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
  // دوستين قبل ما الشيت يتقفل كانوا بيبعتوا الأرشفة مرتين (الميزة 10، L) — زي `SettleSheet`
  const confirmed = useRef(false);

  const allAssigned = items.every(i => assignments[i.id]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text>
            <Text style={styles.intro}>{intro}</Text>

            {items.map(item => (
              <View key={item.id} style={styles.itemCard}>
                <Text style={styles.itemName}>{item.kind}: {item.name}</Text>
                <Text style={styles.label}>{targetLabel}</Text>
                <View style={styles.chipRow}>
                  {targets.map(t => (
                    <PressableScale {...selectionA11y(assignments[item.id] === t.id, 'radio')}
                      key={t.id}
                      // "البنك" لوحدها كانت بتتكرر لكل حاجة من غير ما تقول لأنهي (a11y-architect، الميزة 10)
                      accessibilityLabel={`${t.name}، ل${item.kind} ${item.name}`}
                      onPress={() => setAssignments(a => ({ ...a, [item.id]: t.id }))}
                      style={[styles.chip, selectionStyle(colors, assignments[item.id] === t.id)]}>
                      <Text style={{ color: colors.text, fontSize: typeScale.body }}>{t.name}</Text>
                    </PressableScale>
                  ))}
                </View>
              </View>
            ))}

            {!!note && <Text style={styles.note}>{note}</Text>}
            <Text style={styles.note}>العمليات القديمة والدفعات اللي اتسجلت خلاص مش هتتغير.</Text>
          </ScrollView>

          <View style={styles.footer}>
            <Button variant="secondary" label="إلغاء" style={styles.cancelBtn} onPress={onClose} disabled={busy} />
            <Button
              testID="archive_sheet_confirm"
              label={confirmText}
              style={styles.saveBtn}
              disabled={!allAssigned}
              busy={busy}
              // الزرار المقفول كان بيتقري "مش متاح" من غير ما يقول ليه
              accessibilityHint={allAssigned ? undefined : `اختار ${targetLabel} لكل حاجة`}
              onPress={() => {
                if (confirmed.current) return;
                confirmed.current = true;
                onConfirm(assignments);
              }} />
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
    intro: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', lineHeight: 19, marginTop: space.xs },
    itemCard: { backgroundColor: c.surface2, borderRadius: radius.lg, padding: space.lg, marginTop: space.xl, borderWidth: 1, borderColor: c.border },
    itemName: { color: c.text, fontSize: typeScale.body, fontWeight: '700', textAlign: 'right' },
    label: { color: c.textSecondary, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.md, marginBottom: space.xs },
    chipRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: MIN_TOUCH, justifyContent: 'center' },
    note: { color: c.textMuted, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xl, lineHeight: 17 },
    footer: stickyFooterStyle(c, c.nav),
    cancelBtn: { flex: 1 },
    saveBtn: { flex: 2 },
  });
}
