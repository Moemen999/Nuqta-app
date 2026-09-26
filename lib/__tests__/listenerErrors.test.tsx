import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import DataLoadErrorBanner from '@/components/DataLoadErrorBanner';
import { ThemeProvider } from '@/context/ThemeContext';
import {
  LISTENER_LABELS, LOAD_ERROR_RETRY, LOAD_ERROR_TITLE, listenerNamesPhrase, loadErrorBody, walletActionBlockedBy,
  walletBlockedBody, type ListenerName,
} from '@/lib/listenerErrors';

/**
 * listener بيترفض ← فايربيز بتقفله نهائي. قبل كده مكانش فيه ولا error
 * callback، فالقايمة كانت بتفضل فاضية ساكتة (اتكشف 2026-09-26: `incomes` كانت
 * مرفوضة في الإنتاج). الاختبارات دي بتمنع رجوع ده.
 */

describe('كل listener في DataContext ليه error callback', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'context', 'DataContext.tsx'), 'utf8');
  // كل نداء onSnapshot لوحده، لحد النداء اللي بعده — عشان كل listener يتفحص
  // بالـcallbacks بتوعه هو، مش بالعدد الإجمالي في الملف
  const blocks = src.split('onSnapshot(').slice(1);

  it('فيه listeners أصلاً', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks.map((b, i) => [i + 1, b]))('listener رقم %i: loaded و failed بنفس الاسم', (_i, block) => {
    const failed = (block as string).match(/\}, failed\('([a-z_]+)'\)\);/);
    const loaded = (block as string).match(/\(snap\) => \{\s*loaded\('([a-z_]+)'\);/);
    expect(failed?.[1]).toBeDefined();
    expect(loaded?.[1]).toBe(failed?.[1]);
  });

  it('كل مجموعة ليها اسم عربي، ومفيش اتنين بنفس الاسم', () => {
    const names = blocks.map(b => b.match(/failed\('([a-z_]+)'\)/)?.[1]);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(Object.keys(LISTENER_LABELS).sort());
  });
});

describe('walletActionBlockedBy — مسح/أرشفة المحفظة بيقفوا لو بيانات الرصيد ناقصة', () => {
  it('العمليات أو الديون ما وصلتش ← ممنوع، والرسالة بتسمّيهم', () => {
    const missing = walletActionBlockedBy(['budgets', 'transactions', 'debts']);
    expect(missing).toEqual(['transactions', 'debts']);
    expect(walletBlockedBody(missing)).toContain('العمليات والديون');
  });
  it('الميزانية أو الشخبطة بس ← مش بيأثروا على الرصيد، مسموح', () => {
    expect(walletActionBlockedBy(['budgets', 'shakhbata_income'])).toEqual([]);
  });
});

describe('listenerNamesPhrase', () => {
  it.each<[ListenerName[], string]>([
    [['incomes'], 'الدخل الثابت'],
    [['debts', 'wallets'], 'المحافظ والديون'],
    [['incomes', 'wallets', 'transactions'], 'المحافظ، العمليات، والدخل الثابت'],
  ])('%j ← %s', (names, phrase) => {
    expect(listenerNamesPhrase(names)).toBe(phrase);
  });
});

describe('loadErrorBody', () => {
  it('بيقول إيه اللي ما وصلش، إن الفاضي مش حقيقي، وتعمل إيه', () => {
    const body = loadErrorBody(['incomes']);
    expect(body).toContain('الدخل الثابت');
    expect(body).toContain('مش ضايعة');
    expect(body).toContain(LOAD_ERROR_RETRY);
    expect(body).toContain('شاركنا رأيك');
  });
});

const mockData: { loadErrors: ListenerName[]; retryLoad: jest.Mock } = { loadErrors: [], retryLoad: jest.fn() };
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

describe('DataLoadErrorBanner', () => {
  const mount = () => render(<ThemeProvider><DataLoadErrorBanner /></ThemeProvider>);
  beforeEach(() => { mockData.loadErrors = []; mockData.retryLoad.mockClear(); });

  it('مفيش أخطاء ← مفيش بانر', async () => {
    await mount();
    expect(screen.queryByTestId('data_load_error_banner')).toBeNull();
  });

  it('listener اترفض ← العنوان والاسم وزرار "جرّب تاني" بيفتح الـlisteners من الأول', async () => {
    mockData.loadErrors = ['incomes', 'debts'];
    await mount();
    expect(screen.getByText(LOAD_ERROR_TITLE)).toBeTruthy();
    expect(screen.getByTestId('data_load_error_body').props.children).toContain('الديون والدخل الثابت');
    fireEvent.press(screen.getByTestId('data_load_error_retry'));
    expect(mockData.retryLoad).toHaveBeenCalledTimes(1);
  });
});
