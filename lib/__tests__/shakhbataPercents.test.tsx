import ShakhbataView from '@/components/ShakhbataView';
import { ThemeProvider } from '@/context/ThemeContext';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { percentInvalidBody, percentInvalidTitle } from '@/lib/finance';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

/**
 * التحقق من النسب لازم **يوصل للمستخدم بالاسم**.
 *
 * أول نسخة من الإصلاح ده حطّت `onBlur` على كل خانة بيرجّع الرقم الغلط
 * للمحفوظ. اتضح إنه بيبلع الرسالة: في React Native الضغط على "حفظ النسب"
 * بيعمل blur للخانة الأول، فالرقم كان بيختفي بصمت قبل ما التحقق يشتغل
 * أصلاً. الاختبار ده بيثبّت السلوك الصح: الرقم بيفضل، والرسالة بتقول إيه
 * اللي مش مظبوط.
 */

const mockData = {
  categories: [],
  transactions: [],
  shakhbataIncome: {} as Record<string, number>,
  shakhbataPercents: { needs: 50, wants: 30, future: 20 },
  updateCategory: jest.fn(),
  setMonthlyIncome: jest.fn(),
  setShakhbataPercents: jest.fn(async () => {}),
};

jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));

async function renderView() {
  return render(<ThemeProvider><PrivacyProvider><ShakhbataView /></PrivacyProvider></ThemeProvider>);
}

/** بيفتح وضع التعديل ويرجّع خانات النسب التلاتة بالترتيب */
async function startEditing() {
  await renderView();
  await act(async () => { fireEvent.press(screen.getByText('عدّل النسب')); });
  return screen.getAllByDisplayValue(/^\d+$/);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockData.shakhbataPercents = { needs: 50, wants: 30, future: 20 };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('حفظ النسب', () => {
  it('نسبة أكبر من 100 بتوقف الحفظ وبتتسمّى بالاسم', async () => {
    const inputs = await startEditing();
    await act(async () => { fireEvent.changeText(inputs[0], '150'); });
    await act(async () => { fireEvent.press(screen.getByText('حفظ النسب')); });

    expect(mockData.setShakhbataPercents).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      percentInvalidTitle(1),
      percentInvalidBody(['احتياجات']),
    );
  });

  it('نسبة سالبة كمان', async () => {
    const inputs = await startEditing();
    await act(async () => { fireEvent.changeText(inputs[1], '-5'); });
    await act(async () => { fireEvent.press(screen.getByText('حفظ النسب')); });

    expect(mockData.setShakhbataPercents).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      percentInvalidTitle(1),
      percentInvalidBody(['رفاهيات']),
    );
  });

  it('كلام مش رقم بيترفض — مش بيتحوّل لصفر', async () => {
    const inputs = await startEditing();
    await act(async () => { fireEvent.changeText(inputs[2], 'تلاتين'); });
    await act(async () => { fireEvent.press(screen.getByText('حفظ النسب')); });

    expect(mockData.setShakhbataPercents).not.toHaveBeenCalled();
  });

  it('اتنين غلط بيتسمّوا الاتنين', async () => {
    const inputs = await startEditing();
    await act(async () => { fireEvent.changeText(inputs[0], '150'); });
    await act(async () => { fireEvent.changeText(inputs[1], '-1'); });
    await act(async () => { fireEvent.press(screen.getByText('حفظ النسب')); });

    expect(Alert.alert).toHaveBeenCalledWith(
      percentInvalidTitle(2),
      percentInvalidBody(['احتياجات', 'رفاهيات']),
    );
  });

  it('الرقم الغلط بيفضل في الخانة عشان المستخدم يشوف الرسالة وهو شايفه', async () => {
    const inputs = await startEditing();
    await act(async () => { fireEvent.changeText(inputs[0], '150'); });
    await act(async () => { fireEvent.press(screen.getByText('حفظ النسب')); });

    expect(screen.getByDisplayValue('150')).toBeTruthy();
  });

  it('نسب مظبوطة بتتحفظ', async () => {
    const inputs = await startEditing();
    await act(async () => { fireEvent.changeText(inputs[0], '60'); });
    await act(async () => { fireEvent.changeText(inputs[1], '25'); });
    await act(async () => { fireEvent.changeText(inputs[2], '15'); });
    await act(async () => { fireEvent.press(screen.getByText('حفظ النسب')); });

    expect(mockData.setShakhbataPercents).toHaveBeenCalledWith({ needs: 60, wants: 25, future: 15 });
  });

  it('المجموع مش 100 بيتحفظ برضه — تحذير ناعم مش منع', async () => {
    const inputs = await startEditing();
    await act(async () => { fireEvent.changeText(inputs[0], '10'); });
    await act(async () => { fireEvent.press(screen.getByText('حفظ النسب')); });

    expect(mockData.setShakhbataPercents).toHaveBeenCalledWith({ needs: 10, wants: 30, future: 20 });
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
