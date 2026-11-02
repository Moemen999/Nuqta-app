import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { spoken } from '@/components/NoticeProvider';
import { MIN_TOUCH, overlayCenteredStyle } from '@/lib/tokens';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Dimensions, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

/**
 * تأكيد فيه اختيار ("امسح" / "إلغاء") بشكل التطبيق — بديل `Alert.alert` بأزرار (خط النهاية:
 * "مكوّن تأكيد بشكل التطبيق بدل Alert"). نفس شكل `NoticeProvider` (رسالة النتيجة): عربي من
 * اليمين، بألوان الثيمين، والـAlert الأصلي على أندرويد كان عنوانه على الشمال وأبيض في الغامق.
 *
 * **نفس توقيع `Alert.alert(عنوان، جملة، أزرار)`** عشان النقل من الـ63 مكان يبقى سطر بسطر:
 * `const confirm = useConfirm(); confirm(title, body, [{ text: 'إلغاء', style: 'cancel' }, …])`.
 *
 * - الشباك بيتقفل **قبل** ما `onPress` يتنادى (زي الـAlert): الفعل ممكن يفتح رسالة نتيجة أو
 *   مودال، ومينفعش يبقوا تحت التأكيد.
 * - دوستين بسرعة ← فعل واحد بس: الزرار بيتنفّذ لو التأكيد اللي اتعرض لسه هو اللي على الشاشة.
 * - "رجوع" في أندرويد = زرار `cancel` لو موجود (بيتنادى `onPress` بتاعه)، ولو مفيش بيقفل بس.
 * - تأكيدات ورا بعض بتتصف، ومن غير Provider (اختبار، أو برّه الشجرة) بيرجع للـAlert الأصلي.
 * - الترتيب من اليمين: الأفعال بالترتيب اللي اتبعتت بيه، و"إلغاء" آخر واحد على الشمال.
 */

export type ConfirmButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => unknown };
type Confirm = (title: string, body: string, buttons: ConfirmButton[]) => void;
type Pending = { title: string; body: string; buttons: ConfirmButton[] };

const ConfirmContext = createContext<Confirm | null>(null);

const nativeConfirm: Confirm = (title, body, buttons) => Alert.alert(title, body, buttons);

export function useConfirm(): Confirm {
  return useContext(ConfirmContext) ?? nativeConfirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([]);
  // نسخة متزامنة من الطابور: دالة التحديث بتاعة setState مش مضمون تتنادى على طول، فالقرار
  // "الدوسة دي على الشباك اللي على الشاشة؟" لازم يتاخد من هنا
  const live = useRef<Pending[]>([]);
  const show = useCallback<Confirm>((title, body, buttons) => {
    live.current = [...live.current, { title, body, buttons }];
    setQueue(live.current);
  }, []);
  const current = queue[0] ?? null;

  // بيقفل اللي اتعرض بس، وبعدين بينادي الفعل — دوسة تانية على نفس الشباك وهو بيختفي متتنفّذش
  const choose = useCallback((shown: Pending, button?: ConfirmButton) => {
    if (live.current[0] !== shown) return;
    live.current = live.current.slice(1);
    setQueue(live.current);
    button?.onPress?.();
  }, []);

  return (
    <ConfirmContext.Provider value={show}>
      {children}
      <ConfirmDialog pending={current} onChoose={choose} />
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ pending, onChoose }: { pending: Pending | null; onChoose: (shown: Pending, b?: ConfirmButton) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const height = Dimensions.get('window').height;
  const cancel = pending?.buttons.find(b => b.style === 'cancel');
  const actions = pending?.buttons.filter(b => b.style !== 'cancel') ?? [];
  const back = () => { if (pending) onChoose(pending, cancel); };

  return (
    <Modal visible={!!pending} transparent animationType="fade" onRequestClose={back} statusBarTranslucent>
      <View style={styles.overlay}>
        {pending && (
          <View testID="confirm_dialog" style={styles.card} accessibilityViewIsModal>
            <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={styles.textBlock}>
              <View accessible accessibilityLabel={spoken(pending)}>
                <Text testID="confirm_title" style={styles.title}>{pending.title}</Text>
                {!!pending.body && <Text testID="confirm_body" style={styles.body}>{pending.body}</Text>}
              </View>
            </ScrollView>
            <View style={styles.row}>
              {actions.map((b, i) => {
                const danger = b.style === 'destructive';
                return (
                  <TouchableOpacity key={`${b.text}_${i}`} testID={`confirm_action_${i}`}
                    style={[styles.btn, danger ? styles.dangerBtn : styles.primaryBtn]}
                    onPress={() => onChoose(pending, b)} accessibilityRole="button">
                    <Text style={danger ? styles.dangerText : styles.primaryText}>{b.text}</Text>
                  </TouchableOpacity>
                );
              })}
              {cancel && (
                <TouchableOpacity testID="confirm_cancel" style={[styles.btn, styles.cancelBtn]}
                  onPress={() => onChoose(pending, cancel)} accessibilityRole="button">
                  <Text style={styles.cancelText}>{cancel.text}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { ...overlayCenteredStyle, paddingHorizontal: 24 },
    card: {
      alignSelf: 'stretch', backgroundColor: c.nav, borderRadius: 16, borderWidth: 1, borderColor: c.borderStrong,
      borderRightWidth: 4, borderRightColor: c.accent, padding: 20, gap: 8,
    },
    textBlock: { gap: 10 },
    title: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right' },
    body: { color: c.textSecondary, fontSize: 14.5, lineHeight: 22, textAlign: 'right' },
    row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    btn: { flexGrow: 1, minHeight: MIN_TOUCH, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    primaryBtn: { backgroundColor: c.accent },
    primaryText: { color: c.onAccent, fontSize: 15, fontWeight: '700' },
    dangerBtn: { borderWidth: 1.5, borderColor: c.danger },
    dangerText: { color: c.danger, fontSize: 15, fontWeight: '700' },
    cancelBtn: { borderWidth: 1, borderColor: c.borderStrong },
    cancelText: { color: c.textSecondary, fontSize: 15 },
  });
}
