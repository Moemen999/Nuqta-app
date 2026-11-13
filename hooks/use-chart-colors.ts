import { useData } from '@/context/DataContext';
import { useTheme } from '@/context/ThemeContext';
import { assignDistinctChartColors } from '@/lib/chartColors';
import { useMemo } from 'react';

/**
 * توزيع ألوان الرسوم — محسوب مرة واحدة هنا على *كل* فئات/محافظ المستخدم،
 * مش لكل شاشة لوحدها. لو كل شاشة نادت `assignDistinctChartColors` بنفسها على
 * القائمة اللي هي شايفاها بس (مفلترة أو لأ)، فئتين ممكن ياخدوا نفس اللون في
 * شاشة وألوان مختلفة في شاشة تانية — أو حتى في نفس الشاشة بين فترتي تقرير
 * مختلفتين، لأن `assignDistinctChartColors` بتحل التصادم حسب مين محتاج خانة الأول.
 * المصدر الموحّد هنا يضمن نفس اللون لنفس الفئة/المحفظة في كل مكان.
 */
export function useChartColors() {
  const { categories, wallets } = useData();
  const { colors } = useTheme();

  const categoryColors = useMemo(
    () => assignDistinctChartColors(categories, colors.chartPalette),
    [categories, colors.chartPalette]
  );
  const walletColors = useMemo(
    () => assignDistinctChartColors(wallets, colors.chartPalette),
    [wallets, colors.chartPalette]
  );

  return { categoryColors, walletColors };
}
