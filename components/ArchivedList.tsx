import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.head} onPress={() => setOpen(o => !o)}>
        <Text style={styles.title}>{title} ({items.length})</Text>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </TouchableOpacity>
      {open && items.map(item => (
        <View key={item.id} style={styles.row}>
          <Text style={styles.name}>{item.name}</Text>
          <TouchableOpacity onPress={() => onRestore(item.id, item.name)}>
            <Text style={styles.restore}>رجّعها</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginTop: 14, borderWidth: 1, borderColor: c.border, borderRadius: 12, overflow: 'hidden' },
    head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.surface2, paddingHorizontal: 12, paddingVertical: 11 },
    title: { color: c.textSecondary, fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
    chevron: { color: c.textMuted, fontSize: 12 },
    row: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
    name: { color: c.textSecondary, fontSize: 13, textAlign: 'right' },
    restore: { color: c.accent, fontSize: 12.5, fontWeight: '700' },
  });
}
