import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

/**
 * قسم مطوي افتراضيًا والعنوان فيه العدد — غلاف واحد للمؤرشف (`ArchivedList`) وأقسام
 * "خلص" (ديون اتسددت، جمعيات خلصت، اشتراكات واقفة)، عشان نفس الفعل ليه نفس الشكل.
 * مطوي عشان المستخدم ميرجعلوش نفس الزحمة، والعدد عشان يعرف إن فيه حاجة هناك
 */
export default function FoldedSection({ title, count, children, testID }: {
  title: string;
  count: number;
  children: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  if (count === 0) return null;

  return (
    <View style={styles.wrap} testID={testID}>
      <TouchableOpacity style={styles.head} onPress={() => setOpen(o => !o)}
        testID={testID ? `${testID}_toggle` : undefined}
        accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}، ${count}`}>
        <Text style={styles.title}>{title} ({count})</Text>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && children}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginTop: 14, borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
    head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface2, paddingHorizontal: 12, paddingVertical: 11, minHeight: 44 },
    title: { color: c.textSecondary, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
    chevron: { color: c.textMuted, fontSize: 12 },
  });
}
