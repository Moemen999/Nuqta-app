import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH, space } from '@/lib/tokens';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

/**
 * قسم مطوي افتراضيًا والعنوان فيه العدد — غلاف واحد للمؤرشف (`ArchivedList`) وأقسام
 * "خلص" (ديون اتسددت، جمعيات خلصت، اشتراكات واقفة)، عشان نفس الفعل ليه نفس الشكل.
 * مطوي عشان المستخدم ميرجعلوش نفس الزحمة، والعدد عشان يعرف إن فيه حاجة هناك.
 *
 * `framed` = إطار حوالين الهيدر والمحتوى، للصفوف الخفيفة (المؤرشف). من غيره الهيدر بس
 * ليه شكل، والكروت بتنزل تحته بإطارها هي (visual-identity-reviewer: كارت جوه صندوق كان
 * بيعمل إطار جوه إطار وبيقص الزوايا). `a11yLabel` للي قارئ الشاشة بيقوله: العدد
 * بالمعدود، والاتجاه لما قسمين بنفس الاسم في شاشة واحدة ("ديون اتسددت" تحت ليا وتحت عليا)
 */
export default function FoldedSection({ title, count, children, testID, framed = false, a11yLabel, defaultOpen = false, showCount = true }: {
  title: string;
  count: number;
  children: ReactNode;
  testID?: string;
  framed?: boolean;
  /** اللي قارئ الشاشة بيقوله — العدد بالمعدود ("دينين" مش "(2)") وأي سياق زيادة */
  a11yLabel?: string;
  /** مفتوح من الأول — لما اللي جوّاه محتاج تصرّف (دراسة الشكل خطوة 4، a11y-architect). بيتقري مرة واحدة: مبيقفلش وانت شغال */
  defaultOpen?: boolean;
  /** «(العدد)» بعد العنوان — يتقفل لما العنوان نفسه فيه عدد بمعنى تاني («صنّف فئاتك — 3 لسه») */
  showCount?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  const label = showCount ? `${title} (${count})` : title;

  return (
    <View style={framed ? styles.framed : styles.plain} testID={testID}>
      <TouchableOpacity style={[styles.head, !framed && styles.headAlone, !framed && open && styles.headOpen]}
        onPress={() => setOpen(o => !o)}
        testID={testID ? `${testID}_toggle` : undefined}
        accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={a11yLabel ?? label}>
        <Text style={styles.title}>{label}</Text>
        {/* RTL: المطوي بيشاور ناحية الشمال (اتجاه القراية) */}
        <Text style={styles.chevron} importantForAccessibility="no" accessibilityElementsHidden>{open ? '▾' : '◂'}</Text>
      </TouchableOpacity>
      {open && children}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    framed: { marginTop: space.xl, borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
    plain: { marginTop: space.xl },
    head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface2, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: MIN_TOUCH },
    headAlone: { borderRadius: 12, borderWidth: 1, borderColor: c.border },
    headOpen: { marginBottom: space.md },
    title: { color: c.textSecondary, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
    chevron: { color: c.textMuted, fontSize: 12 },
  });
}
