import { Text } from '@/components/AppText';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { useTheme } from '@/context/ThemeContext';
import { TRANSFERS_FAILED_NOTE, TRANSFERS_LOADING, TRANSFERS_SLOW, TRANSFERS_SLOW_MS } from '@/lib/spending';
import { useEffect, useState } from 'react';
import { View, type StyleProp, type TextStyle } from 'react-native';
import { radius, space, typeScale } from '@/lib/tokens';

/**
 * بند 11 (قرار مؤمن 2026-11-05): رقم المصروف مبيظهرش لحد ما الديون والجمعية يوصلوا — من غيرهم السلفة وقسط
 * الجمعية بيتعدّوا مصروف لحظة. ده اللي بيتعرض مكان الرقم.
 */
export function SpendLoading({ testID, style, shape = 'hero', announce = true }: { testID?: string; style?: StyleProp<TextStyle>; shape?: 'hero' | 'line' | 'bars'; announce?: boolean }) {
  const { colors } = useTheme();
  // لو الديون مبتوصلش (أوفلاين من أول فتحة) — الرسالة بتتغيّر بدل ما "بنحمّل…" تفضل للأبد (silent-failure-hunter جولة 1)
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), TRANSFERS_SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  // حاوية ثابتة بـ`polite`: المحتوى جواها بيتبدّل (هيكل ← جملة البطء) من غير ما العقدة تتشال وتتركّب تاني، فالتغيير بيتعلن.
  // `announce={false}` لأي نسخة زيادة في نفس الشاشة (التقارير فيها كذا واحدة) — واحدة بس تعلن
  return (
    <View accessibilityLiveRegion={announce ? 'polite' : 'none'}>
      {slow ? (
        // بعد المهلة الجملة نفسها بتتعرض (مفيش نت): الهيكل مبيقولش «في حاجة غلط»
        <Text testID={testID} style={[{ color: colors.textSecondary, fontSize: typeScale.body, textAlign: 'right' }, style]}>
          {TRANSFERS_SLOW}
        </Text>
      ) : (
        // هيكل بشكل اللي هييجي: الرقم البطل (ارتفاع سطر الـ34)، أو سطر صغير، أو أعمدة. الحاوية بتتقري «بنحمّل…» مرة واحدة
        <SkeletonGroup testID={testID} label={TRANSFERS_LOADING} style={shape === 'line' ? undefined : { alignItems: 'flex-end', gap: space.md, paddingVertical: space.xs }}>
          {shape === 'hero' && <Skeleton width={150} height={typeScale.hero} />}
          {shape === 'line' && <Skeleton width={44} height={typeScale.body} />}
          {shape === 'bars' && [1, 0.7, 0.45].map(w => <Skeleton key={w} width={`${w * 100}%`} height={10} style={{ borderRadius: radius.pill }} />)}
        </SkeletonGroup>
      )}
    </View>
  );
}

/** الديون أو الجمعية اترفضوا: الرقم بيظهر، والسطر ده بيقول إنه ممكن يكون فيه سلف */
export function TransfersFailedNote({ testID, style }: { testID?: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return (
    <Text testID={testID} style={[{ color: colors.dangerText, fontSize: typeScale.caption, textAlign: 'right', marginTop: space.xs }, style]}>
      {TRANSFERS_FAILED_NOTE}
    </Text>
  );
}
