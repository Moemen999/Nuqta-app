import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH, overlayCenteredStyle } from '@/lib/tokens';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/**
 * رسالة نتيجة بزرار واحد ("تمام") بشكل التطبيق نفسه — بديل `Alert.alert` في
 * مسارات الفلوس (2026-09-29).
 *
 * الـAlert الأصلي على أندرويد عنوانه على الشمال، وزراره "OK" بالإنجليزي، وأبيض
 * حتى في الثيم الغامق — وده بالظبط لحظة رقم فلوس اتغيّر ("الأقساط بقت 8 بدل
 * 6")، أو ما اتسجلش. الرسالة هنا عربي من اليمين، بألوان الثيمين، وزرار "تمام".
 *
 * **ليه في الجذر مش جوه كل مودال:** مودالات الدفعة والزيادة بتتقفل بعد الحفظ
 * على طول، فرسالة جواها كانت هتختفي معاها. هنا الرسالة بتفضل لحد ما تتقفل.
 *
 * **ومبتضيّعش رسالة:** رسايل ورا بعض بتتصف (اللي جاية بتظهر بعد ما اللي قبلها
 * تتقفل)، ومن غير Provider (اختبار، أو كومبوننت برّه الشجرة) بترجع للـAlert
 * الأصلي.
 *
 * **أندرويد بس:** التطبيق مفيهوش `ios` في app.config.js. لو اتضاف iOS، اتأكد
 * الأول إن Modal فوق Modal مفتوح (زي فشل الدفعة والمودال لسه مفتوح) بيظهر هناك —
 * iOS مبيضمنش ده، ورسالة فشل مختفية أوحش من رسالة شكلها مش بتاعنا.
 */

export type Notice = { title: string; body: string };
type Show = (title: string, body: string) => void;

const NoticeContext = createContext<Show | null>(null);

const nativeAlert: Show = (title, body) => Alert.alert(title, body);

/** `notice(عنوان، جملة)` — نفس توقيع `Alert.alert(عنوان، جملة)` بزرار واحد */
export function useNotice(): Show {
  const ctx = useContext(NoticeContext);
  return ctx ?? nativeAlert;
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Notice[]>([]);
  const show = useCallback<Show>((title, body) => {
    setQueue(q => [...q, { title, body }]);
  }, []);
  const current = queue[0] ?? null;

  return (
    <NoticeContext.Provider value={show}>
      {children}
      <NoticeDialog notice={current} onDismiss={() => setQueue(q => q.slice(1))} />
    </NoticeContext.Provider>
  );
}

/** العنوان والجملة في جملة واحدة للقارئ — من غير "؟." ولا نقطة زيادة لو الجملة فاضية */
export function spoken({ title, body }: Notice): string {
  const t = title.trim();
  const b = body.trim();
  if (!b) return t;
  return /[.؟!؛:]$/.test(t) ? `${t} ${b}` : `${t}. ${b}`;
}

function NoticeDialog({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // قارئ الشاشة: الـAlert الأصلي كان بيتقري لوحده — هنا لازم نعلن عنه
  const announced = useRef<Notice | null>(null);
  useEffect(() => {
    if (notice && announced.current !== notice) {
      announced.current = notice;
      AccessibilityInfo.announceForAccessibility(spoken(notice));
    }
  }, [notice]);

  return (
    <Modal visible={!!notice} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.overlay}>
        {notice && (
          <View testID="notice_dialog" style={styles.card} accessibilityViewIsModal>
            <Text testID="notice_title" style={styles.title} accessibilityRole="header">{notice.title}</Text>
            <Text testID="notice_body" style={styles.body}>{notice.body}</Text>
            <TouchableOpacity testID="notice_ok" style={styles.okBtn} onPress={onDismiss} accessibilityRole="button">
              <Text style={styles.okText}>تمام</Text>
            </TouchableOpacity>
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
      borderRightWidth: 4, borderRightColor: c.accent, padding: 20, gap: 10,
    },
    title: { color: c.text, fontSize: 17, fontWeight: '700', textAlign: 'right' },
    body: { color: c.textSecondary, fontSize: 14.5, lineHeight: 22, textAlign: 'right' },
    okBtn: {
      marginTop: 8, backgroundColor: c.accent, borderRadius: 10, minHeight: MIN_TOUCH,
      alignItems: 'center', justifyContent: 'center',
    },
    okText: { color: c.onAccent, fontSize: 15, fontWeight: '700' },
  });
}
