import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { MIN_TOUCH, space, radius, typeScale } from '@/lib/tokens';
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
 *
 * تلات إضافات اختيارية (فلتر فئات التقارير)، ومن غيرها الشكل والسلوك زي ما كانوا بالظبط:
 * `alwaysShow` = القسم يظهر حتى لو `count` صفر (الفلتر مطوي وفيه اختيار أو من غيره)،
 * `status` = كلمة على السطر بعد العنوان («— فئتين مختارتين») عشان اللي جوّه المطوي مبيستخباش،
 * `action` = زرار جنب السطر نفسه من غير ما تفتح القسم («مسح الفلتر»).
 */
export default function FoldedSection({ title, count, children, testID, framed = false, a11yLabel, defaultOpen = false, showCount = true, alwaysShow = false, status, action }: {
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
  alwaysShow?: boolean;
  status?: string;
  action?: { label: string; onPress: () => void; testID?: string; a11yLabel?: string };
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0 && !alwaysShow) return null;
  const base = showCount ? `${title} (${count})` : title;
  const label = status ? `${base} — ${status}` : base;

  const toggle = (
    <TouchableOpacity style={[styles.head, !framed && styles.headAlone, !framed && open && !action && styles.headOpen, action && styles.headGrow]}
      onPress={() => setOpen(o => !o)}
      testID={testID ? `${testID}_toggle` : undefined}
      accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={a11yLabel ?? label}>
      {/* العدد (والحالة) نص لوحده جنب العنوان مش آخر سطر العنوان: أندرويد/Fabric على الجهاز قاس
          «ديون اتسددت (5)» أضيق من المرسوم وقصّ «(5)» في الثيم الفاتح (2026-11-16). العدد بقى عنصر
          flexShrink:0 فمبيتقصّش، والعنوان هو اللي بيتقلّص. بيتقري كله بـ`accessibilityLabel` فوق. */}
      <View style={styles.titleRow}>
        <Text style={[styles.title, styles.titleShrink]} textBreakStrategy="simple">{showCount || !status ? title : base + ' — ' + status}</Text>
        {showCount && <Text style={[styles.title, styles.fixed]}>({count})</Text>}
        {showCount && status ? <Text style={[styles.title, styles.fixed]}>{`— ${status}`}</Text> : null}
      </View>
      {/* RTL: المطوي بيشاور ناحية الشمال (اتجاه القراية) */}
      <Text style={styles.chevron} importantForAccessibility="no" accessibilityElementsHidden>{open ? '▾' : '◂'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={framed ? styles.framed : styles.plain} testID={testID}>
      {action ? (
        <View style={[styles.headRow, !framed && open && styles.headOpen]}>
          {toggle}
          <TouchableOpacity style={[styles.head, styles.headAlone]} onPress={action.onPress} testID={action.testID}
            accessibilityRole="button" accessibilityLabel={action.a11yLabel ?? action.label}>
            <Text style={styles.title}>{action.label}</Text>
          </TouchableOpacity>
        </View>
      ) : toggle}
      {open && children}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    // الإطار باقي هنا عن قصد (مراجعة 9c2a5ab): القسم المطوي جواه صفوف على الصفحة، وخلفية للغلاف كانت هتسطّحها
    framed: { marginTop: space.xl, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, overflow: 'hidden' },
    plain: { marginTop: space.xl },
    head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.controlBg, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: MIN_TOUCH },
    headAlone: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.border },
    headOpen: { marginBottom: space.md },
    headRow: { flexDirection: 'row-reverse', alignItems: 'stretch', gap: space.sm },
    headGrow: { flex: 1 },
    title: { color: c.textSecondary, fontSize: typeScale.caption, fontWeight: '700', textAlign: 'right' },
    titleRow: { flexDirection: 'row-reverse', alignItems: 'center', flexShrink: 1, gap: space.xs },
    titleShrink: { flexShrink: 1 },
    fixed: { flexShrink: 0 },
    chevron: { color: c.textMuted, fontSize: typeScale.caption },
  });
}
