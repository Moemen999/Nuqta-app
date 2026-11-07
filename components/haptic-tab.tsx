import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { hapticSelect } from '@/lib/haptics';

/** التابة بتهتز خفيف مع الدوسة — على أندرويد كمان (كانت آيفون بس من قالب Expo) */
export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        hapticSelect();
        props.onPressIn?.(ev);
      }}
    />
  );
}
