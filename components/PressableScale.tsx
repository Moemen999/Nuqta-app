import { pressedOpacity, pressedScale } from '@/lib/tokens';
import type { Ref } from 'react';
import { Pressable, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native';

/**
 * الضغطة الواحدة للتطبيق (9.5-5 خطوة 3، `reports/2026-11-26-path-to-9-5.md` §شكل 1): بدل `TouchableOpacity`
 * اللي كان بيومّض لـ0.2. نفس إحساس `Button`: شفافية `pressedOpacity` + تصغير `pressedScale` وقت الضغط بس.
 *
 * - نفس أسامي `TouchableOpacity` اللي كنا بنستخدمها (`style` ثابت مش دالة، `activeOpacity`) — النقل تبديل اسم.
 * - `activeOpacity={1}`: من غير أي رد فعل (الخلفية الغامقة ورا الورقة، والكارت اللي بيبلع الدوسة جوّاها).
 * - `activeOpacity` تاني (لوحة الـPIN 0.6): الشفافية دي + التصغير.
 * - معطّل: مفيش رد فعل خالص (زي `TouchableOpacity` — الشكل المعطّل مسؤولية الشاشة).
 * - `collapsable={false}`: الشفافية 1↔0.85 على Pressable من غير خلفية كانت هتخلّي Fabric يعمل unflatten للـView
 *   ويحرّك ولاده وقت الضغط — نفس كراش NUQTA-3 اللي اتصلح في `Button`.
 * - وقت الضغط `opacity` و`transform` بتوعنا بيغلبوا اللي في `style` — زرار متعتّم (مشغول مثلاً) لازم ياخد `disabled`
 *   كمان، وإلا هينوّر لـ0.85 وهو بيتداس (كل اللي موجودين النهارده ماشيين كده — react-reviewer 2026-11-28).
 */
export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  activeOpacity?: number;
  /** React 19: الـref prop عادي — `debts.tsx` بيرجّع تركيز القارئ لزرار «⋯» بيه */
  ref?: Ref<View>;
}

export function PressableScale({ style, activeOpacity = pressedOpacity, disabled, ...rest }: PressableScaleProps) {
  const quiet = activeOpacity >= 1;
  return (
    <Pressable
      collapsable={false}
      {...rest}
      disabled={disabled}
      style={({ pressed }) =>
        pressed && !disabled && !quiet
          ? [style, { opacity: activeOpacity, transform: [{ scale: pressedScale }] }]
          : style}
    />
  );
}
