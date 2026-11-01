import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useMemo } from 'react';
import FoldedSection from '@/components/FoldedSection';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

/**
 * قسم المؤرشف — مطوي افتراضيًا. المستخدم أرشفها عشان تختفي، فلو فتحناها
 * على طول كنا رجّعنا نفس الزحمة اللي هرب منها. العنوان بيقول العدد عشان
 * يعرف إن فيه حاجة هناك أصلاً من غير ما يفتح.
 */
export default function ArchivedList({ title, items, onRestore }: {
  title: string;
  items: { id: string; name: string }[];
  onRestore: (id: string, name: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <FoldedSection title={title} count={items.length}>
      {items.map(item => (
        <View key={item.id} style={styles.row}>
          <Text style={styles.name}>{item.name}</Text>
          <TouchableOpacity onPress={() => onRestore(item.id, item.name)}>
            <Text style={styles.restore}>رجّعها</Text>
          </TouchableOpacity>
        </View>
      ))}
    </FoldedSection>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
    name: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
    restore: { color: c.accentText, fontSize: 12.5, fontWeight: '700' },
  });
}
