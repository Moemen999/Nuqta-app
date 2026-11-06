import { Text } from '@/components/AppText';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH, overlayStyle, radius, sheetStyle, sheetTitleStyle, space, typeScale } from '@/lib/tokens';
import { createContext, useContext, useEffect, useMemo, useRef, type Context, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as SafeArea from 'react-native-safe-area-context';

export type SheetAction = { key: string; label: string; onPress: () => void; danger?: boolean; testID?: string; disabled?: boolean };

/** مهلة احتياطية لو `onDismiss` (iOS بس) ما وصلش — الاختبارات بتستنى القيمة دي (+50) */
export const IOS_DISMISS_FALLBACK_MS = 600;

/** من غير Provider (أو mock للموديول من غيره) — `useContext` بيتنادى دايمًا على context، فالـhooks بنفس الترتيب */
const NO_INSETS = createContext<{ bottom: number } | null>(null);
const InsetsContext = (SafeArea.SafeAreaInsetsContext ?? NO_INSETS) as Context<{ bottom: number } | null>;

/**
 * قايمة "⋯" (دراسة الشكل خطوة 3، قرار مؤمن 2026-11-06): الكارت فيه زرار أساسي واحد، والباقي هنا — كانوا 6 أزرار بنفس
 * الشكل و"حذف" جنبهم. الخطر آخر حاجة ومفصول بمسافة.
 *
 * **متركّبة دايمًا** (`visible` بيتقلب) عشان أنيميشن الخروج يشتغل. **الفعل بيشتغل بعد ما الورقة تختفي فعلاً** على iOS
 * (`onDismiss`) — مودال جديد بيتفتح وهي لسه بتقفل كان بيتسقط ساكت (react-reviewer). أندرويد على طول. الإلغاء بيرجّع
 * تركيز قارئ الشاشة لزرار "⋯" (`returnFocusTo`) بدل ما يضيع وسط الكروت (a11y-architect).
 */
export function ActionSheet({ visible, title, actions, onClose, testID, returnFocusTo }: {
  visible: boolean; title: string; actions: SheetAction[]; onClose: () => void; testID?: string;
  returnFocusTo?: RefObject<View | null>;
}) {
  const { colors } = useTheme();
  // متركّبة دايمًا جوه كروت كتير — من غير Provider (اختبارات، شاشات قديمة) الحافة صفر بدل ما ترمي
  const bottomInset = useContext(InsetsContext)?.bottom ?? 0;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pending = useRef<(() => void) | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  function runPending() {
    if (fallback.current) { clearTimeout(fallback.current); fallback.current = null; }
    const f = pending.current;
    pending.current = null;
    f?.();
  }
  useEffect(() => () => { if (fallback.current) clearTimeout(fallback.current); }, []);

  function choose(a: SheetAction) {
    if (Platform.OS === 'ios') {
      pending.current = a.onPress;
      fallback.current = setTimeout(runPending, IOS_DISMISS_FALLBACK_MS);
      onClose();
    } else {
      onClose();
      a.onPress();
    }
  }
  function cancel() {
    onClose();
    const node = returnFocusTo?.current ? findNodeHandle(returnFocusTo.current) : null;
    if (node) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 300);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cancel} onDismiss={runPending}>
      <TouchableOpacity accessible={false} activeOpacity={1} style={styles.overlay} onPress={cancel}>
        <TouchableOpacity accessible={false} activeOpacity={1} onPress={() => {}} testID={visible ? testID : undefined}
          accessibilityViewIsModal onAccessibilityEscape={cancel}
          style={[styles.sheet, { paddingBottom: space.xxxl + bottomInset }]}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
          {/* سقف وتمرير: بخط كبير أو شاشة صغيرة "إلغاء" و"حذف" كانوا ممكن يطلعوا برّه (a11y-architect) */}
          <ScrollView style={styles.list} bounces={false}>
            {actions.map(a => (
              <TouchableOpacity key={a.key} testID={a.testID} accessibilityRole="button" disabled={a.disabled}
                accessibilityState={{ disabled: !!a.disabled }}
                accessibilityHint={a.danger ? 'هيسألك الأول قبل ما يمسح' : undefined}
                style={[styles.item, a.danger && styles.itemDanger, a.disabled && styles.itemDisabled]}
                onPress={() => choose(a)}>
                <Text style={[styles.itemText, a.danger && { color: colors.dangerText }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity accessibilityRole="button" testID={testID ? `${testID}_cancel` : undefined} style={styles.cancel} onPress={cancel}>
            <Text style={styles.cancelText}>إلغاء</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  const row = MIN_TOUCH + space.xxs;
  return StyleSheet.create({
    overlay: overlayStyle,
    sheet: sheetStyle(c, { maxHeight: '90%' }),
    title: sheetTitleStyle(c, space.sm),
    list: { flexShrink: 1 },
    item: { minHeight: row, justifyContent: 'center', paddingHorizontal: space.xs },
    // الخطر مفصول عن اللي قبله عشان ميتداسش غلط
    itemDanger: { marginTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    itemDisabled: { opacity: 0.5 },
    itemText: { color: c.text, fontSize: typeScale.body, textAlign: 'right' },
    cancel: { minHeight: row, marginTop: space.sm, borderRadius: radius.md, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
    cancelText: { color: c.textSecondary, fontSize: typeScale.body },
  });
}
