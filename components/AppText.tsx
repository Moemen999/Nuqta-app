import { Children, createContext, isValidElement, useContext, type Ref } from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { resolveAppFont, withAppFont } from '@/lib/appFont';

/**
 * `Text` و`TextInput` بخط التطبيق — كل الشاشات بتستورد من هنا مش من
 * `react-native` (اختبار الجرد `appFont.test.tsx` بيرفض غير كده).
 *
 * قبلها كان `applyGlobalFont` بيلف `Text.render`، وفي RN 0.81 الاتنين دوال
 * عادية React مبينادهاش على `.render` — فالخط عمره ما اتطبّق والاختبارات خضرا.
 * التوثيق الرسمي لـRN بيقول نفس الحل: كومبوننت بيلف النص.
 *
 * `ref` بيعدّي لوحده (React 19: الـref خاصية عادية). التابات مش جوه الغلاف
 * (react-navigation بيرسم النص بنفسه) — خطها في `tabLabelStyle()`.
 */

/** وزن النص اللي بره — للنص اللي جوّاه من غير وزن (`resolveAppFont`) */
const InheritedWeight = createContext<TextStyle['fontWeight']>(undefined);

export function Text({ style, children, ...props }: TextProps & { ref?: Ref<RNText> }) {
  const resolved = resolveAppFont(style, useContext(InheritedWeight));
  // نص بس (الأغلبية) ← مفيش جوّاه حاجة تورث، فالـchildren بتعدّي زي ما هي
  const nested = Children.toArray(children).some(isValidElement);
  return (
    <RNText {...props} style={resolved.style}>
      {nested ? <InheritedWeight.Provider value={resolved.weight}>{children}</InheritedWeight.Provider> : children}
    </RNText>
  );
}

export function TextInput({ style, ...props }: TextInputProps & { ref?: Ref<RNTextInput> }) {
  return <RNTextInput {...props} style={withAppFont(style)} />;
}
