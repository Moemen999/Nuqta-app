import React from 'react';
import { View, StyleProp, TextStyle, ViewStyle, StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';
import { space } from '@/lib/tokens';

/**
 * عنوان + عدد/نسبة بين قوسين، كل واحد `Text` لوحده في صف `row-reverse`.
 * ليه: أندرويد/Fabric بيقيس نص RTL فيه «عنوان (5)» أضيق من المرسوم فبيقص آخره
 * (حصل في `FoldedSection` 2026-11-16، واتأكد على الجهاز). العدد `flexShrink:0` فمبيتقصّش،
 * والعنوان هو اللي بيتقلّص. بيتقري كله «عنوان (5)» لقارئ الشاشة.
 * `boxStyle` للهوامش/المحاذاة، و`style` للخط واللون.
 */
export default function CountedText({ title, count, suffix = '', style, boxStyle, testID, accessibilityRole }: {
  title: string; count: number | string; suffix?: string;
  style?: StyleProp<TextStyle>; boxStyle?: StyleProp<ViewStyle>; testID?: string;
  /** `header` لما بيكون عنوان قسم؛ مبنحطهوش على نص جوه زرار (الأب هو صاحب الدور) */
  accessibilityRole?: 'header';
}) {
  return (
    <View style={[s.row, boxStyle]} testID={testID} accessible accessibilityRole={accessibilityRole} accessibilityLabel={`${title} (${count}${suffix})`}>
      <Text style={[style, s.shrink]} textBreakStrategy="simple" importantForAccessibility="no">{title}</Text>
      <Text style={[style, s.fixed]} importantForAccessibility="no">({count}{suffix})</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row-reverse', alignItems: 'center', flexShrink: 1, gap: space.xs },
  shrink: { flexShrink: 1 },
  fixed: { flexShrink: 0 },
});
