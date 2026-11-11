import { useRenderProbe } from '@/lib/perfProbe';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BudgetView from '@/components/BudgetView';
import IncomesView from '@/components/IncomesView';
import ShakhbataView from '@/components/ShakhbataView';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';

type Section = 'budget' | 'shakhbata' | 'incomes';

export default function PlanningScreen() {
  useRenderProbe('Planning');
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [section, setSection] = useState<Section>('budget');

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <SegmentedControl style={styles.switcher} value={section} onChange={setSection} segments={[
        { key: 'budget', label: 'الميزانية', testID: 'planning_tab_budget' },
        { key: 'shakhbata', label: 'توزيع الدخل', testID: 'planning_tab_shakhbata' },
        { key: 'incomes', label: 'دخل ثابت', testID: 'planning_tab_incomes' },
      ]} />

      {section === 'budget' ? <BudgetView /> : section === 'shakhbata' ? <ShakhbataView /> : <IncomesView />}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    switcher: { marginHorizontal: 16, marginBottom: 8 },
  });
}
