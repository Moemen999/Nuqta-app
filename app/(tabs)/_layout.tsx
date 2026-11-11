import { router, Tabs, usePathname } from 'expo-router';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/AppText';

import { HapticTab } from '@/components/haptic-tab';
import { LineIcon, type LineIconName } from '@/components/LineIcon';
import { useTheme } from '@/context/ThemeContext';
import { tabLabelStyle } from '@/lib/appFont';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * **ومبيستخبّاش أبدًا** (2026-09-29، رجوع في قرار 2026-09-27): كان بيستخبّى طول
 * ما فيه كارت "نزل؟"/"اتخصم؟" أو مفيش ولا محفظة — ومستخدم فاتح عشان يسجل مصروف
 * بسرعة مكانش لاقيه. أهم فعل في التطبيق. لو قعد فوق حاجة، الحاجة هي اللي
 * بتتنقل: الرئيسية كلها بتسكرول تحت الرصيد وفي آخرها مسافة أطول من الزرار.
 * ومن غير محفظة شاشة العملية نفسها فيها "ضيف محفظة".
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

/**
 * التاب المستخبي مبيترسمش (بند D، 2026-11-11). القياس على الشاومي (`reports/2026-11-11-render-probe-measure.md`): كل عملية
 * بتتحفظ = 3–4 رسمات للـ`DataProvider`، وحوالي 80% من زمنها كان في التابات اللي مش قدام المستخدم. التاب بيترسم بآخر
 * بيانات أول ما ترجعله.
 *
 * **الرئيسية برّه عن قصد:** `ChargeAutoNotices`/`IncomeAutoNotices` فيها هما اللي بيشغّلوا التسجيل التلقائي، ولازم يفضلوا
 * شغالين وانت في تاب تاني. أي تاب جديد فيه effect لازم يشتغل وهو مستخبي ميتحطش عليه العلم ده.
 */
const FREEZE_HIDDEN_TAB = true;

export default function TabLayout() {
  const { colors } = useTheme();
  const pathname = usePathname();
  const showFab = FAB_TAB_PATHS.includes(pathname);
  const insets = useSafeAreaInsets();
  // التاب المختار: خلفية دهبي غامق ورا الأيقونة (دراسة الشكل خطوة 6) — كان باللون بس، فمن غير لون مكانش باين أنهي المختار

  return (
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
            freezeOnBlur: FREEZE_HIDDEN_TAB,
            title: 'التقارير',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['pie-chart-outline', 'pie-chart']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
        <Tabs.Screen
          name="planning"
          options={{
            freezeOnBlur: FREEZE_HIDDEN_TAB,
            title: 'التخطيط',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['layers-outline', 'layers']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
        <Tabs.Screen
          name="debts"
          options={{
            freezeOnBlur: FREEZE_HIDDEN_TAB,
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
            freezeOnBlur: FREEZE_HIDDEN_TAB,
            title: 'الإعدادات',
            tabBarIcon: ({ color, focused }) => <TabBarIcon name={['settings-outline', 'settings']} color={color} focused={focused} selectedBg={colors.selectedBg} selectedBorder={colors.selectedBorder} />,
          }}
        />
      </Tabs>

      {showFab && (
        <TouchableOpacity testID="tx_add_button" accessibilityRole="button" accessibilityLabel="إضافة عملية" style={[styles.fab, { backgroundColor: colors.accent, bottom: Math.max(90, 66 + insets.bottom) }]} onPress={() => router.push('/modal')}>
          <Text style={[styles.fabText, { color: colors.onAccent }]}>+</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    // `bottom` بيتحسب من حافة الشاشة (مش 90 ثابت — موبايل بشريط تنقّل أطول كان بيغطّي الزرار على التاب)
    position: 'absolute', alignSelf: 'center', width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabText: { fontSize: 28, fontWeight: '700', marginTop: -2 },
  iconPill: { width: 52, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
});
