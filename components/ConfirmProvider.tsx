import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useAppLock } from '@/context/AppLockContext';
import { spoken } from '@/components/NoticeProvider';
import { MIN_TOUCH, overlayCenteredStyle, space } from '@/lib/tokens';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Dimensions, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

/**
 * تأكيد فيه اختيار ("امسح" / "إلغاء") بشكل التطبيق — بديل `Alert.alert` بأزرار (خط النهاية:
 * "مكوّن تأكيد بشكل التطبيق بدل Alert"). نفس شكل `NoticeProvider` (رسالة النتيجة): عربي من
 * اليمين، بألوان الثيمين، والـAlert الأصلي على أندرويد كان عنوانه على الشمال وأبيض في الغامق.
 *
 * **نفس توقيع `Alert.alert(عنوان، جملة، أزرار، {cancelable, onDismiss})`** عشان النقل من الـ63
 * مكان يبقى سطر بسطر: `const confirm = useConfirm(); confirm(title, body, [...])`.
 *
 * - الشباك بيتقفل **قبل** ما `onPress` يتنادى (زي الـAlert): الفعل ممكن يفتح رسالة نتيجة أو
 *   مودال، ومينفعش يبقوا تحت التأكيد.
 * - دوستين بسرعة ← فعل واحد بس: الزرار بيتنفّذ لو التأكيد اللي اتعرض لسه هو اللي على الشاشة.
 * - "رجوع" في أندرويد = زرار `cancel` لو موجود، ولو مفيش `onDismiss`، ولو مفيش بيقفل بس.
 * - **التطبيق اتقفل (القفل) ← كل التأكيدات المفتوحة بتتلغي** (react-reviewer H1): الـModal نافذة
 *   لوحدها، فكان هيفضل فوق شاشة القفل ونصه باين وزراره شغّال من غير الكود. الإلغاء بينادي
 *   `cancel`/`onDismiss` عشان أي `Promise` مستني الإجابة يتحل (H2) ومزرار يفضل يلف.
 * - **مقفول ← بيتلغي على طول**، فشاشة القفل ("نسيت الكود؟") بتفضل على Alert الأصلي.
 * - **نفس التأكيد (عنوان وجملة) مرتين ← واحد بس**؛ تأكيدات مختلفة ورا بعض بتتصف، ومن غير Provider (اختبار، أو برّه الشجرة) بيرجع للـAlert الأصلي.
 * - الترتيب: الفعل على اليمين و"إلغاء" على الشمال — نفس فوتر المودالات في التطبيق كله
 *   (visual-identity-reviewer). فعلين + إلغاء ← تحت بعض.
 * - **المبالغ في النص زي ما هي:** المسارات بتبعت المبلغ صريح عن قصد (مش جوه `PrivacyProvider`).
 * - **أندرويد بس** زي `NoticeProvider`: فتح شيت من `onPress` والتأكيد بيختفي آمن هنا (شباكين
 *   منفصلين)؛ لو اتضاف iOS لازم يتأجّل لبعد الإغلاق (react-reviewer H3).
 */

export type ConfirmButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => unknown };
export type ConfirmOptions = { cancelable?: boolean; onDismiss?: () => unknown };
type Confirm = (title: string, body: string, buttons: ConfirmButton[], options?: ConfirmOptions) => void;
type Pending = { title: string; body: string; buttons: ConfirmButton[]; options?: ConfirmOptions };

const ConfirmContext = createContext<Confirm | null>(null);

const nativeConfirm: Confirm = (title, body, buttons, options) =>
  (options ? Alert.alert(title, body, buttons, options) : Alert.alert(title, body, buttons));

export function useConfirm(): Confirm {
  return useContext(ConfirmContext) ?? nativeConfirm;
}

/** واحد رمى ← الباقي لسه بيتلغي (Promise تاني ميعلقش) */
function safely(fn?: () => unknown) {
  try { fn?.(); } catch (e) { console.warn('[confirm] dismiss handler threw', e instanceof Error ? e.name : 'unknown'); }
}

/** الإلغاء من غير ما المستخدم يختار (رجوع، قفل) — زرار الإلغاء، ولو مفيش `onDismiss`. **`cancelable` مبيتقراش:**
 * "رجوع" بيلغي دايمًا (Alert على أندرويد افتراضيه بيتجاهله، وده كان بيسيب المستخدم محبوس) */
function dismissAction(p: Pending) {
  return p.buttons.find(b => b.style === 'cancel')?.onPress ?? p.options?.onDismiss;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { isLocked } = useAppLock();
  const [queue, setQueue] = useState<Pending[]>([]);
  // نسخة متزامنة من الطابور: دالة التحديث بتاعة setState مش مضمون تتنادى على طول، فالقرار
  // "الدوسة دي على الشباك اللي على الشاشة؟" لازم يتاخد من هنا
  const live = useRef<Pending[]>([]);
  const lockedRef = useRef(isLocked);
  lockedRef.current = isLocked;
  const show = useCallback<Confirm>((title, body, buttons, options) => {
    const p: Pending = { title, body, buttons, options };
    // مقفول ← مفيش تأكيد فوق شاشة القفل خالص، بيتلغي على طول (react-reviewer: إلغاء بيفتح تأكيد
    // جديد، أو عملية async خلصت والتطبيق في الخلفية). شاشة القفل نفسها بتستخدم Alert الأصلي
    if (lockedRef.current) { safely(dismissAction(p)); return; }
    // نفس التأكيد معروض أو مستني ← دوستين على "حفظ" قبل ما الشباك يظهر (money-reviewer): الطابور
    // كان هيعرض اتنين، و"أيوة" مرتين = دفعتين. التاني بيتلغي (الـPromise بتاعه بيتحل "لأ")
    if (live.current.some(q => q.title === title && q.body === body)) { safely(dismissAction(p)); return; }
    live.current = [...live.current, p];
    setQueue(live.current);
  }, []);
  const current = queue[0] ?? null;

  // بيقفل اللي اتعرض بس، وبعدين بينادي الفعل — دوسة تانية على نفس الشباك وهو بيختفي متتنفّذش
  const choose = useCallback((shown: Pending, action?: () => unknown) => {
    if (live.current[0] !== shown) return;
    live.current = live.current.slice(1);
    setQueue(live.current);
    action?.();
  }, []);

  useEffect(() => {
    if (!isLocked || live.current.length === 0) return;
    const dropped = live.current;
    live.current = [];
    setQueue([]);
    dropped.forEach(p => safely(dismissAction(p)));
  }, [isLocked]);

  return (
    <ConfirmContext.Provider value={show}>
      {children}
      <ConfirmDialog pending={current} onChoose={choose} />
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ pending, onChoose }: { pending: Pending | null; onChoose: (shown: Pending, action?: () => unknown) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Dimensions مش useWindowDimensions: زي NoticeProvider (الهوك بيكسر اختبار الـsplash)
  const height = Dimensions.get('window').height;
  const view = pending;
  const cancel = view?.buttons.find(b => b.style === 'cancel');
  const actions = view?.buttons.filter(b => b.style !== 'cancel') ?? [];
  const back = () => { if (pending) onChoose(pending, dismissAction(pending)); };

  return (
    <Modal visible={!!pending} transparent animationType="fade" onRequestClose={back} statusBarTranslucent>
      <View style={styles.overlay}>
        {view && (
          <View testID={pending ? 'confirm_dialog' : undefined} style={[styles.card, { maxHeight: height * 0.9 }]} accessibilityViewIsModal>
            {/* بتتسكرول، والأزرار برّه السكرول: بخط 200% الجملة الطويلة متزقّش الأزرار برّه الشاشة */}
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.textBlock}>
              <View accessible accessibilityLabel={spoken(view)}>
                <Text testID="confirm_title" style={styles.title}>{view.title}</Text>
                {!!view.body && <Text testID="confirm_body" style={styles.body}>{view.body}</Text>}
              </View>
            </ScrollView>
            <View style={[styles.row, actions.length > 1 && styles.stack]}>
              {actions.map((b, i) => {
                const danger = b.style === 'destructive';
                return (
                  <TouchableOpacity key={`${b.text}_${i}`} testID={`confirm_action_${i}`}
                    style={[styles.btn, danger ? styles.dangerBtn : styles.primaryBtn]}
                    onPress={() => pending && onChoose(pending, b.onPress)} accessibilityRole="button"
                    // الخطر مش باللون بس (a11y-architect): القارئ بيقوله، والليبل نفسه = النص الظاهر (أوامر الصوت)
                    accessibilityHint={danger ? 'تأكيد فعل خطر' : undefined}>
                    <Text style={danger ? styles.dangerText : styles.primaryText}>{b.text}</Text>
                  </TouchableOpacity>
                );
              })}
              {cancel && (
                <TouchableOpacity testID="confirm_cancel" style={[styles.btn, styles.cancelBtn]}
                  onPress={() => pending && onChoose(pending, cancel.onPress)} accessibilityRole="button">
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
    row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
    stack: { flexDirection: 'column' },
    btn: {
      flexGrow: 1, minHeight: MIN_TOUCH, borderRadius: 10, paddingHorizontal: space.xxl, paddingVertical: space.md,
      alignItems: 'center', justifyContent: 'center',
    },
    primaryBtn: { backgroundColor: c.accent },
    primaryText: { color: c.onAccent, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    dangerBtn: { borderWidth: 1.5, borderColor: c.danger },
    // نص الخطر expenseText مش danger: danger كنص على nav ‏4.14–4.42 تحت 4.5 (visual-identity-reviewer)
    dangerText: { color: c.expenseText, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    cancelBtn: { borderWidth: 1, borderColor: c.borderStrong },
    cancelText: { color: c.textSecondary, fontSize: 15, textAlign: 'center' },
  });
}
