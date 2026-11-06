import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, typeScale } from '@/lib/tokens';
import { useMemo } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SheetAction = { key: string; label: string; onPress: () => void; danger?: boolean; testID?: string; disabled?: boolean };

/**
 * قايمة "⋯" (دراسة الشكل خطوة 3، قرار مؤمن 2026-11-06): الكارت فيه زرار أساسي واحد، والباقي هنا — كانوا 6 أزرار بنفس
 * الشكل و"حذف" جنبهم. الخطر آخر حاجة ولونه بس اللي مختلف. الورقة بتتقفل **قبل** ما الفعل يشتغل، عشان أي تأكيد أو
 * مودال بعده يفتح لوحده مش فوقها.
 */
export function ActionSheet({ visible, title, actions, onClose, testID }: {
  visible: boolean; title: string; actions: SheetAction[]; onClose: () => void; testID?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity accessible={false} activeOpacity={1} style={styles.overlay} onPress={onClose}>
        <TouchableOpacity accessible={false} activeOpacity={1} onPress={() => {}} testID={testID}
          accessibilityViewIsModal onAccessibilityEscape={onClose}
          style={[styles.sheet, { paddingBottom: space.xxxl + insets.bottom }]}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
          {actions.map(a => (
            <TouchableOpacity key={a.key} testID={a.testID} accessibilityRole="button" disabled={a.disabled}
              accessibilityState={{ disabled: !!a.disabled }}
              style={[styles.item, a.disabled && styles.itemDisabled]}
              onPress={() => { onClose(); a.onPress(); }}>
              <Text style={[styles.itemText, a.danger && { color: colors.dangerText }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity accessibilityRole="button" testID={testID ? `${testID}_cancel` : undefined} style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>إلغاء</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: sheetStyle(c),
    title: sheetTitleStyle(c, space.sm),
    item: { minHeight: MIN_TOUCH + space.xxs, justifyContent: 'center', paddingHorizontal: space.xs },
    itemDisabled: { opacity: 0.5 },
    itemText: { color: c.text, fontSize: typeScale.body, textAlign: 'right' },
    cancel: { minHeight: MIN_TOUCH, marginTop: space.sm, borderRadius: radius.md, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    cancelText: { color: c.textSecondary, fontSize: typeScale.body },
  });
}
