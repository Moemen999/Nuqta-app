import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BudgetView from '@/components/BudgetView';
import ShakhbataView from '@/components/ShakhbataView';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';

type Section = 'budget' | 'shakhbata';

export default function PlanningScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [section, setSection] = useState<Section>('budget');

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.switcherRow}>
        <TouchableOpacity
          onPress={() => setSection('budget')}
          style={[styles.switchBtn, { borderColor: section === 'budget' ? colors.accent : colors.borderStrong }]}>
          <Text style={{ color: section === 'budget' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>
            الميزانية
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSection('shakhbata')}
          style={[styles.switchBtn, { borderColor: section === 'shakhbata' ? colors.accent : colors.borderStrong }]}>
          <Text style={{ color: section === 'shakhbata' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>
            شخبطة (النِسب)
          </Text>
        </TouchableOpacity>
      </View>

      {section === 'budget' ? <BudgetView /> : <ShakhbataView />}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    switcherRow: { flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
    switchBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', paddingVertical: 9 },
  });
}
