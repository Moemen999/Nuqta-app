import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/AppText';
import { HeroIcon } from '@/components/HeroIcon';
import type { LineIconName } from '@/components/LineIcon';
import { useTheme } from '@/context/ThemeContext';
import { heroIconSize, space, typeScale } from '@/lib/tokens';

/**
 * حالة فاضية صغيرة جوه قايمة (الاشتراكات، الجمعية، الديون): أيقونة خطية صغيرة فوق الجملة، في النص.
 * الأيقونة زينة (HeroIcon مخبّيها عن قارئ الشاشة) — الجملة هي اللي بتتقري.
 */
export function EmptyHint({ icon, message, testID }: { icon: LineIconName; message: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={styles.wrap}>
      <HeroIcon name={icon} size={heroIconSize.inline} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: space.xl, gap: space.sm },
  text: { fontSize: typeScale.body, textAlign: 'center' },
});
