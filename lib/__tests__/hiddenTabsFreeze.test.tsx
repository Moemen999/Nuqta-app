import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';
import TabLayout from '@/app/(tabs)/_layout';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * التاب المستخبي مبيترسمش (بند D، 2026-11-11) — والرئيسية **لأ**.
 *
 * القياس على الشاومي: حوالي 80% من زمن إعادة الرسم بعد كل عملية كان في التابات اللي مش قدام المستخدم.
 * بس الرئيسية فيها `ChargeAutoNotices`/`IncomeAutoNotices` اللي بيشغّلوا التسجيل التلقائي: لو اتجمّدت، اشتراك "بيتسجل لوحده"
 * كان هيستنى لحد ما المستخدم يرجع للرئيسية. الاختبار ده بيثبّت الاتنين، وبيرفض إن التسجيل التلقائي يتنقل لتاب متجمّد.
 */

type ScreenProps = { name: string; options?: { freezeOnBlur?: boolean } };
const mockScreens: ScreenProps[] = [];
jest.mock('expo-router', () => {
  const Tabs = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Tabs.Screen = (props: ScreenProps) => { mockScreens.push(props); return null; };
  return { Tabs, usePathname: () => '/', router: { push: jest.fn() } };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const FROZEN = ['reports', 'planning', 'debts', 'settings'];
const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('التابات المستخبية', () => {
  beforeAll(() => {
    mockScreens.length = 0;
    render(<ThemeProvider><TabLayout /></ThemeProvider>);
  });

  it('التابات الخمسة موجودة بنفس الأسامي', () => {
    expect(mockScreens.map(s => s.name)).toEqual(['index', ...FROZEN]);
  });

  it('الرئيسية مبتتجمّدش — التسجيل التلقائي شغال منها', () => {
    const home = mockScreens.find(s => s.name === 'index');
    expect(home?.options?.freezeOnBlur).toBeFalsy();
  });

  it.each(FROZEN)('تاب %s بيتجمّد وهو مستخبي', (name) => {
    expect(mockScreens.find(s => s.name === name)?.options?.freezeOnBlur).toBe(true);
  });

  it('مفيش وسيلة تانية بتجمّد كل الشاشات (enableFreeze كان هيجمّد الرئيسية كمان)', () => {
    for (const rel of ['app/_layout.tsx', 'app/(tabs)/_layout.tsx']) {
      expect(read(rel)).not.toMatch(/enableFreeze\s*\(/);
    }
    expect(read('app/(tabs)/_layout.tsx')).not.toMatch(/screenOptions=\{\{[^}]*freezeOnBlur/s);
  });

  it('`detachInactiveScreens` متسابة على الافتراضي — لو اتقفلت التجميد بيبطل ساكت (react-reviewer)', () => {
    // react-native-screens: من غير detach الشاشة بتترسم `View` عادي ومفيش Freeze. الاختبار ده حارس إعداد بس —
    // إن التجميد شغال فعلاً بيتقاس على الموبايل بعدّاد الرسم (`reports/2026-11-11-render-probe-measure.md`)
    expect(read('app/(tabs)/_layout.tsx')).not.toMatch(/detachInactiveScreens/);
  });

  it('التسجيل التلقائي مش متركّب في تاب متجمّد', () => {
    // كل ملف في `components/` بيتستورد من تاب متجمّد — مباشرة أو عن طريق مكوّن تاني. القايمة محسوبة من الاستيراد مش مكتوبة
    // بالإيد: قايمة مكتوبة كانت ناقصة `IncomesView` و`DebtEntryModals` من أول يوم (silent-failure-hunter)
    const resolve = (spec: string) => ['.tsx', '.ts'].map(ext => `${spec.replace(/^@\//, '')}${ext}`).find(rel => fs.existsSync(path.join(ROOT, rel)));
    const frozenTree = new Set(FROZEN.map(name => `app/(tabs)/${name}.tsx`));
    for (const rel of frozenTree) {
      for (const m of read(rel).matchAll(/from '(@\/components\/[^']+)'/g)) {
        const hit = resolve(m[1]);
        if (hit) frozenTree.add(hit);
      }
    }
    expect([...frozenTree]).toEqual(expect.arrayContaining([
      'components/BudgetView.tsx', 'components/IncomesView.tsx', 'components/SubscriptionsView.tsx', 'components/GamiyaView.tsx', 'components/DebtEntryModals.tsx',
    ]));
    for (const rel of frozenTree) {
      expect({ rel, hit: /ChargeAutoNotices|IncomeAutoNotices|useChargeAutoRecord|useIncomeAutoRecord/.test(read(rel)) })
        .toEqual({ rel, hit: false });
    }
    // والعكس: لسه في الرئيسية
    const home = read('app/(tabs)/index.tsx');
    expect(home).toMatch(/ChargeAutoNotices/);
    expect(home).toMatch(/IncomeAutoNotices/);
  });
});
