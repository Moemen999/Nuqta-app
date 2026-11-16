import { router, Tabs, usePathname } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

import { HapticTab } from '@/components/haptic-tab';
import { LineIcon, type LineIconName } from '@/components/LineIcon';
import { FabScrollProvider, useFabVisible } from '@/context/FabScrollContext';
import { useTheme } from '@/context/ThemeContext';
import { tabLabelStyle } from '@/lib/appFont';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius } from '@/lib/tokens';

/**
 * التابات اللي الزرار العايم بيظهر فيها. الإعدادات مفيهاش عمليات خالص،
 * والديون ليها زراير إضافة بتاعتها جوه كل تحت-تاب (دين/اشتراك/جمعية) — فزرار
 * "+" عام فوقيهم بيزوّد لبس أكتر ما بيفيد.
 *
 * قايمة سماح مش قايمة منع عن قصد: التابات دي أساسها ثابت، والقايمة بالشكل ده
 * بتغطي كمان الشاشات اللي بتتفتح فوق التابات (الأرشيف، دليل المستخدم، مودال
 * العملية) — الشاشة الجديدة بتدخل بحركة انزلاق، ومن غير كده الزرار كان ممكن
 * يلمع تحتها لحظة وهي داخلة وهو مكانش ظاهر قبلها.
 * `usePathname` بيشيل أقواس المجموعات وبيقصّ `index`، يعني التابات بتطلع
 * '/' و'/reports' و'/planning' و'/debts' و'/settings'.
 *
 * الإخفاء بالشرط مش بإزاحة: الزرار `position: 'absolute'` فمش داخل في حساب
 * التخطيط أصلاً، يعني ظهوره واختفاؤه مش بيحرّك ولا عنصر في أي شاشة.
 *
 * **مبيستخبّاش بسبب أي حاجة غير التمرير** (2026-09-29، رجوع في قرار 2026-09-27):
 * كان بيستخبّى طول ما فيه كارت "نزل؟"/"اتخصم؟" أو مفيش ولا محفظة — ومستخدم فاتح
 * عشان يسجل مصروف بسرعة مكانش لاقيه. أهم فعل في التطبيق. لو قعد فوق حاجة،
 * الحاجة هي اللي بتتنقل. ومن غير محفظة شاشة العملية نفسها فيها "ضيف محفظة".
 * **الاستثناء الوحيد: التمرير** (قرار مؤمن 2026-11-16، «يختفي في حالة
 * الحركة فقط»): بيختفي وانت بتمرّر لتحت وبيرجع أول ما ترفع صباعك (أو فورًا لو
 * مرّرت لفوق). ظاهر دايمًا عند فتح
 * التطبيق وعند تغيير التاب (والتاب الفرعي في التخطيط) وفي أول الشاشة. المنطق في
 * `lib/fabScroll.ts` والحالة في `context/FabScrollContext.tsx`.
 */
const FAB_TAB_PATHS = ['/', '/reports', '/planning'];

/** التابة: [خطي، مليان] — المختارة مليانة */
type TabIcon = readonly [LineIconName, LineIconName];

/**
 * التاب المختار: خلفية دهبي غامق **وإطار دهبي** (دراسة الشكل خطوة 6). الخلفية لوحدها 1.5–1.75:1 على الشريط، واللون بين
 * المختار والباقي قريب في الإضاءة — الإطار ≥ 5:1 هو اللي بيشيل المؤشر (a11y-architect)
 */
function TabBarIcon({ name, color, focused, selectedBg, selectedBorder }: {
  name: TabIcon; color: string; focused: boolean; selectedBg: string; selectedBorder: string;
}) {
  return (
    <View style={[styles.iconPill, focused && { backgroundColor: selectedBg, borderColor: selectedBorder }]}>
      <LineIcon size={22} name={focused ? name[1] : name[0]} color={color} />
    </View>
  );
}

/** المسافة اللي الزرار بينزلها وهو بيختفي — لحد ما يبقى ورا شريط التابات */
const FAB_HIDE_DISTANCE = 140;
const FAB_ANIM_MS = 200;

/**
 * الزرار نفسه: حركة نزول + شفافية. لو "تقليل الحركة" شغّال ← من غير حركة.
 * وهو مستخبي مبيتدوسش (الإخفاء بصري بس)، ومع قارئ الشاشة بيفضل ظاهر دايمًا.
 */
function FabButton({ visible, bottom }: { visible: boolean; bottom: number }) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current; // 1 = ظاهر
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    try {
      AccessibilityInfo.isReduceMotionEnabled?.()?.then((v) => { if (alive) setReduceMotion(!!v); }).catch(() => {});
    } catch { /* مفيش إعداد ← بالحركة */ }
    let sub: { remove: () => void } | undefined;
    try { sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { if (alive) setReduceMotion(!!v); }); } catch { /* زي فوق */ }
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) { progress.setValue(visible ? 1 : 0); return; }
    const anim = Animated.timing(progress, { toValue: visible ? 1 : 0, duration: FAB_ANIM_MS, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [visible, reduceMotion, progress]);

  return (
    <Animated.View
      testID="tx_add_fab_wrap"
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.fabWrap, {
        bottom,
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [FAB_HIDE_DISTANCE, 0] }) }],
      }]}>
      <TouchableOpacity testID="tx_add_button" accessibilityRole="button" accessible accessibilityLabel="إضافة عملية" style={[styles.fab, { backgroundColor: colors.accent }]} onPress={() => router.push('/modal')}>
        <LineIcon name="add" size={30} color={colors.onAccent} />
      </TouchableOpacity>
    </Animated.View>
  );
}

function FabHost() {
  const pathname = usePathname();
  const visible = useFabVisible();
  const insets = useSafeAreaInsets();
  if (!FAB_TAB_PATHS.includes(pathname)) return null;
  return <FabButton visible={visible} bottom={Math.max(90, 66 + insets.bottom)} />;
}

export default function TabLayout() {
  const { colors } = useTheme();
  // التاب المختار: خلفية دهبي غامق ورا الأيقونة (دراسة الشكل خطوة 6) — كان باللون بس، فمن غير لون مكانش باين أنهي المختار

  return (
    <FabScrollProvider>
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          // accentText مش accent: اسم التاب المختار نص، والدهبي الفاتح على الكريمي 2.2:1
          tabBarActiveTintColor: colors.accentText,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: { backgroundColor: colors.nav, borderTopColor: colors.border },
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarLabelStyle: tabLabelStyle(),
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'الرئيسية',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['home-outline', 'home']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'التقارير',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['pie-chart-outline', 'pie-chart']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
        <Tabs.Screen
          name="planning"
          options={{
            title: 'التخطيط',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['layers-outline', 'layers']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
        <Tabs.Screen
          name="debts"
          options={{
            // «الالتزامات» مش «الديون» (دراسة الشكل، قرار مؤمن 2026-11-06): جوّه كمان الاشتراكات والجمعية
            title: 'الالتزامات',
            // سكريبت روبو بيوصل لتاب الديون من هنا. من غير معرّف كان بيتطابق
            // بنص عربي، وأي تغيير في الكلمة كان هيفشّل التشغيلة كلها.
            tabBarButtonTestID: 'nav_tab_debts',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['people-outline', 'people']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'الإعدادات',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['settings-outline', 'settings']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
      </Tabs>

      <FabHost />
    </View>
    </FabScrollProvider>
  );
}

const styles = StyleSheet.create({
  // `bottom` بيتحسب من حافة الشاشة (مش 90 ثابت — موبايل بشريط تنقّل أطول كان بيغطّي الزرار على التاب)
  fabWrap: { position: 'absolute', alignSelf: 'center' },
  fab: {
    width: 54, height: 54, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  iconPill: { width: 52, height: 28, borderRadius: radius.pill, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
});
