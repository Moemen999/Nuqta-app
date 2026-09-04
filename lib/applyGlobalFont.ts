import { Text, TextInput } from 'react-native';

/**
 * بيطبّق خط Tajawal على كل نصوص التطبيق مرة واحدة، بدل ما نعدّل كل <Text> في كل ملف.
 * بيختار الوزن المناسب تلقائيًا حسب fontWeight الموجود في الاستايل.
 */
export function applyGlobalFont() {
  const pickFamily = (style: any): string => {
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style || {});
    const weight = String(flat.fontWeight || '');
    if (weight === '700' || weight === '800' || weight === '900' || weight === 'bold') {
      return 'Tajawal_700Bold';
    }
    if (weight === '500' || weight === '600') {
      return 'Tajawal_500Medium';
    }
    return 'Tajawal_400Regular';
  };

  const patch = (Component: any) => {
    const original = Component.render;
    Component.render = function (...args: any[]) {
      const element = original.apply(this, args);
      return {
        ...element,
        props: {
          ...element.props,
          style: [{ fontFamily: pickFamily(element.props?.style) }, element.props?.style],
        },
      };
    };
  };

  patch(Text as any);
  patch(TextInput as any);
}
