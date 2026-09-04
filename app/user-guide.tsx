import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type ThemeColors } from '@/context/ThemeContext';

type Section = { id: string; icon: string; title: string; body: string[] };

const SECTIONS: Section[] = [
  {
    id: 'basics',
    icon: '💰',
    title: 'المحافظ والعمليات',
    body: [
      'المحافظ هي الأماكن اللي فلوسك فيها (بنك، كاش، محفظة إلكترونية). تقدر تضيف وتعدل أسماءها من الإعدادات.',
      'الرصيد الابتدائي: المبلغ اللي كان موجود في المحفظة قبل ما تبدأ تستخدم التطبيق.',
      'حد التنبيه: لو الرصيد نزل تحت الرقم ده، هيظهرلك تنبيه في الرئيسية.',
      'فيه 3 أنواع عمليات: مصروف (فلوس خرجت)، إيراد (فلوس دخلت)، سحب (تحويل بين محفظتين — مش بيغيّر إجماليك).',
      'الزرار الذهبي (+) في أي شاشة بيفتحلك تسجيل عملية جديدة.',
    ],
  },
  {
    id: 'reports',
    icon: '📈',
    title: 'التقارير',
    body: [
      'اختار فترة (هذا الشهر، آخر 7 أيام، الشهر الماضي، أو مخصص) وشوف مصاريفك فيها.',
      'فلتر الفئات: دوس على فئة أو أكتر عشان تشوف مصاريفها بس. دوس تاني عشان تشيلها.',
      'المقارنة بالفترة السابقة بتقارن تلقائيًا بنفس عدد الأيام قبلها.',
      'كشف حساب الأشخاص: بيجمع كل تعاملاتك مع كل شخص. دوس على أي اسم تشوف كشف تفصيلي زي كشف البنك.',
    ],
  },
  {
    id: 'planning',
    icon: '📊',
    title: 'التخطيط',
    body: [
      'الميزانية: تحدد سقف إجمالي للشهر، وسقف لكل فئة. الشريط بيتلوّن أصفر لما تقرب من السقف، وأحمر لما تتجاوزه.',
      'شخبطة: بتقسّم دخلك الشهري على 3 أقسام بالنسب اللي انت تحددها (مش لازم 50/30/20).',
      'عشان شخبطة تشتغل، لازم تصنّف فئاتك الأول: كل فئة تبع احتياجات ولا رفاهيات ولا خطط مستقبلية.',
    ],
  },
  {
    id: 'debts',
    icon: '👥',
    title: 'الديون',
    body: [
      '"ليا" = أنت اللي قرضت حد. "عليا" = حد قرضك.',
      'مرتبط بمحفظة؟ لو أيوة، الفلوس هتتخصم أو تتضاف لرصيدك فورًا. لو لأ (شرا بالأجل مثلاً)، الدين بيتسجل من غير ما يأثر على رصيدك، والتأثير بيحصل وقت السداد بس.',
      'زيادة على الدين: لو نفس الشخص استلف تاني، تقدر تزوّد على نفس السجل بتاريخ جديد بدل ما تعمل دين منفصل.',
      'أيقونة جهات الاتصال جنب حقل الاسم بتخليك تختار من جهات اتصالك، وبعدين اسم الشخص في الكارت يبقى قابل للضغط ويفتحلك كارته.',
    ],
  },
  {
    id: 'subs',
    icon: '🔁',
    title: 'الاشتراكات',
    body: [
      'للمصاريف اللي بتتكرر (نتفليكس، جيم، إنترنت...).',
      'بتحدد المبلغ والتكرار (شهري، سنوي، أو كل كام يوم) وأول موعد استحقاق.',
      'التذكير: بتحدد بنفسك تتنبّه قبل الموعد بكام يوم، والتنبيه بيظهر في الرئيسية.',
      'زرار "اتخصم" بيسجل العملية على محفظتك ويحسب موعد الاستحقاق الجاي تلقائيًا.',
    ],
  },
  {
    id: 'gamiya',
    icon: '🤝',
    title: 'الجمعية',
    body: [
      'بتحدد القسط الشهري، عدد الشهور، والشهر اللي هتستلم فيه ومبلغ الاستلام.',
      'التطبيق بيبني جدول بكل الشهور تلقائيًا.',
      'في الشهور العادية بتدوس "اتخصم" (بيسجل مصروف)، وفي شهر الاستلام بتدوس "استلمت" (بيسجل إيراد).',
      'ملاحظة: المبالغ وعدد الشهور مش بيتعدلوا بعد الإنشاء عشان الجدول اتبنى عليهم. لو محتاج تغيّرهم، امسح الجمعية واعملها من جديد.',
    ],
  },
  {
    id: 'archive',
    icon: '📄',
    title: 'الأرشيف والتصدير',
    body: [
      'من الإعدادات، بيوريك كل عملياتك (مش آخر 10 بس زي الرئيسية).',
      'فيه فلتر فترة، وإجمالي الإيرادات والمصروفات فيها.',
      'زرار "تصدير إكسيل" بيعمل ملف بكل عمليات الفترة، تقدر تشاركه أو تفتحه في أي برنامج جداول.',
    ],
  },
  {
    id: 'security',
    icon: '🔒',
    title: 'الأمان والخصوصية',
    body: [
      'قفل التطبيق اختياري: تقدر تفعّله برقم سري (4 أرقام) أو باسورد نصي.',
      'تحدد يطلب القفل إمتى: مرة واحدة عند فتح التطبيق، أو كل مرة ترجع له.',
      'لو اخترت "كل مرة ترجع"، تقدر تحدد مهلة (فورًا، بعد دقيقة، 5، أو 15 دقيقة) عشان ميضايقكش لو خرجت لثانية.',
      'القفل بيحمي الجهاز نفسه، فطبيعي يطلبه حتى بعد ما تسجل خروج من حسابك.',
      'بياناتك محفوظة في حسابك انت بس، ومحدش تاني يقدر يشوفها.',
    ],
  },
];

export default function UserGuideScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [openId, setOpenId] = useState<string | null>('basics');

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>‹ رجوع</Text>
        </TouchableOpacity>
        <Text style={styles.title}>دليل المستخدم</Text>
      </View>

      <Text style={styles.intro}>كل حاجة في التطبيق، مشروحة بالتفصيل. دوس على أي قسم عشان تفتحه.</Text>

      {SECTIONS.map(s => {
        const isOpen = openId === s.id;
        return (
          <View key={s.id} style={styles.card}>
            <TouchableOpacity style={styles.cardHead} onPress={() => setOpenId(isOpen ? null : s.id)}>
              <Text style={styles.cardTitle}>{s.icon}  {s.title}</Text>
              <Text style={styles.chevron}>{isOpen ? '−' : '+'}</Text>
            </TouchableOpacity>
            {isOpen && (
              <View style={styles.cardBody}>
                {s.body.map((line, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{line}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      <Text style={styles.footer}>نقطة — نقطة على السطر</Text>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    backText: { color: c.accent, fontSize: 14 },
    title: { color: c.text, fontSize: 17, fontWeight: '700' },
    intro: { color: c.textSecondary, fontSize: 12.5, textAlign: 'right', marginBottom: 16, lineHeight: 19 },
    card: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, marginBottom: 10, overflow: 'hidden' },
    cardHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
    cardTitle: { color: c.text, fontSize: 14.5, fontWeight: '700' },
    chevron: { color: c.accent, fontSize: 20, fontWeight: '700' },
    cardBody: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
    bulletRow: { flexDirection: 'row-reverse', marginBottom: 10 },
    bulletDot: { color: c.accent, fontSize: 14, marginLeft: 8, marginTop: 1 },
    bulletText: { flex: 1, color: c.textSecondary, fontSize: 13, textAlign: 'right', lineHeight: 21 },
    footer: { color: c.textMuted, fontSize: 12, textAlign: 'center', marginTop: 20 },
  });
}
