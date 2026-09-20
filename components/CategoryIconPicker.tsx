import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from '@/lib/finance';
import { selectionStyle } from '@/lib/selection';
import { overlayStyle, sheetStyle, sheetTitleStyle, stickyFooterStyle } from '@/lib/tokens';
import { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export const ICON_PICKER_TITLE = 'اختار أيقونة';
export const ICON_PICKER_HINT = 'الأيقونة بتظهر جنب اسم الفئة في كل مكان — العمليات والتقارير والميزانية.';
export const ICON_PICKER_DEFAULT_LABEL = 'من غير أيقونة';

/**
 * `CATEGORY_ICONS` كانت موجودة في `lib/finance.ts` من غير أي واجهة تكتب
 * `icon` خالص: `categoryLabel` كانت بتعرضها لو موجودة، والقايمة كانت
 * متعرّفة، وولا سطر في التطبيق كان بيحطها. يعني حقل بيتقري ومبيتكتبش.
 */
export default function CategoryIconPicker({
  visible, current, onPick, onClose,
}: {
  visible: boolean;
  current?: string;
  onPick: (icon: string | undefined) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.sheetContent}>
            <Text style={styles.title}>{ICON_PICKER_TITLE}</Text>
            <Text style={styles.hint}>{ICON_PICKER_HINT}</Text>

            <View style={styles.grid}>
              <TouchableOpacity
                testID="icon_pick_default"
                onPress={() => onPick(undefined)}
                style={[styles.cell, styles.defaultCell, selectionStyle(colors, !current)]}>
                <Text style={styles.icon}>{DEFAULT_CATEGORY_ICON}</Text>
                <Text style={styles.defaultLabel}>{ICON_PICKER_DEFAULT_LABEL}</Text>
              </TouchableOpacity>

              {CATEGORY_ICONS.map(ic => (
                <TouchableOpacity
                  key={ic}
                  testID={`icon_pick_${ic}`}
                  onPress={() => onPick(ic)}
                  style={[styles.cell, selectionStyle(colors, current === ic)]}>
                  <Text style={styles.icon}>{ic}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity testID="icon_pick_close" style={styles.closeBtn} onPress={onClose}>
              <Text style={{ color: colors.textSecondary }}>تمام</Text>
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
    sheet: { ...sheetStyle(c, { maxHeight: '80%' }), padding: 0, overflow: 'hidden' },
    scrollArea: { flexShrink: 1 },
    sheetContent: { padding: 20 },
    title: sheetTitleStyle(c, 4),
    hint: { color: c.textMuted, fontSize: 11.5, textAlign: 'right', marginTop: 6, marginBottom: 14, lineHeight: 17 },
    grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
    cell: {
      width: 56, height: 56, borderWidth: 1.5, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
    },
    defaultCell: { width: '100%', height: 52, flexDirection: 'row-reverse', gap: 8 },
    defaultLabel: { color: c.textSecondary, fontSize: 13 },
    icon: { fontSize: 24 },
    footer: stickyFooterStyle(c, c.nav),
    closeBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, alignItems: 'center', paddingVertical: 12 },
  });
}
