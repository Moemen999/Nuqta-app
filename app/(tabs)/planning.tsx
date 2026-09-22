import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BudgetView from '@/components/BudgetView';
import IncomesView from '@/components/IncomesView';
import ShakhbataView from '@/components/ShakhbataView';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';
import { selectionStyle } from '@/lib/selection';
import { MIN_TOUCH } from '@/lib/tokens';

type Section = 'budget' | 'shakhbata' | 'incomes';

export default function PlanningScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [section, setSection] = useState<Section>('budget');

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.switcherRow}>
        <TouchableOpacity
          testID="planning_tab_budget"
          onPress={() => setSection('budget')}
          accessibilityRole="tab"
          accessibilityState={{ selected: section === 'budget' }}
          style={[styles.switchBtn, selectionStyle(colors, section === 'budget')]}>
          <Text numberOfLines={1} style={{ color: section === 'budget' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>
            الميزانية
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="planning_tab_shakhbata"
          onPress={() => setSection('shakhbata')}
          accessibilityRole="tab"
          accessibilityState={{ selected: section === 'shakhbata' }}
          style={[styles.switchBtn, selectionStyle(colors, section === 'shakhbata')]}>
          <Text numberOfLines={1} style={{ color: section === 'shakhbata' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>
            شخبطة
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="planning_tab_incomes"
          onPress={() => setSection('incomes')}
          accessibilityRole="tab"
          accessibilityState={{ selected: section === 'incomes' }}
          style={[styles.switchBtn, selectionStyle(colors, section === 'incomes')]}>
          <Text numberOfLines={1} style={{ color: section === 'incomes' ? colors.text : colors.textSecondary, fontSize: 12.5, fontWeight: '600' }}>
            دخل ثابت
          </Text>
        </TouchableOpacity>
      </View>

      {section === 'budget' ? <BudgetView /> : section === 'shakhbata' ? <ShakhbataView /> : <IncomesView />}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    switcherRow: { flexDirection: 'row-reverse', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
    // تلات تابات على ٣٦٠: سطر واحد وارتفاع ثابت عشان محدش يطلع أطول من التاني.
    // «شخبطة (النِسب)» كانت هتتقص بـ… في ١٠٤ بكسل — الشاشة نفسها بتشرح النِسب
    switchBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH, paddingHorizontal: 4 },
  });
}
