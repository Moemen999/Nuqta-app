import React from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConfirmProvider, useConfirm, type ConfirmButton } from '@/components/ConfirmProvider';
import { NoticeProvider, useNotice } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { Text } from '@/components/AppText';

/**
 * مكوّن التأكيد بشكل التطبيق (خط النهاية): نفس توقيع `Alert.alert(عنوان، جملة، أزرار)`،
 * والشباك بيتقفل قبل الفعل، ودوستين = فعل واحد، و"رجوع" = إلغاء.
 */

let mockLocked = false;
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: mockLocked }) }));
beforeEach(() => { mockLocked = false; });

let confirmFn: ReturnType<typeof useConfirm>;
let noticeFn: ReturnType<typeof useNotice>;
function Grab() {
  confirmFn = useConfirm();
  noticeFn = useNotice();
  return <TouchableOpacity testID="noop"><Text>x</Text></TouchableOpacity>;
}
const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><Grab /></ConfirmProvider></NoticeProvider></ThemeProvider>;
const wrap = () => render(ui());

async function ask(buttons: ConfirmButton[], title = 'مسح الدين', body = 'هيتمسح الدين ودفعاته.') {
  await act(async () => { confirmFn(title, body, buttons); });
}

it('بيعرض العنوان والجملة والأزرار بتاعة الفعل والإلغاء', async () => {
  await wrap();
  await ask([{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive', onPress: jest.fn() }]);
  expect(screen.getByTestId('confirm_title').props.children).toBe('مسح الدين');
  expect(screen.getByTestId('confirm_body').props.children).toBe('هيتمسح الدين ودفعاته.');
  expect(screen.getByText('حذف')).toBeTruthy();
  expect(screen.getByText('إلغاء')).toBeTruthy();
});

it('الفعل بيتنادى بعد ما الشباك يتقفل، ومرة واحدة حتى لو اتداس مرتين', async () => {
  await wrap();
  const seen: boolean[] = [];
  const onPress = jest.fn(() => { seen.push(!!screen.queryByTestId('confirm_dialog')); });
  await ask([{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive', onPress }]);
  const btn = screen.getByTestId('confirm_action_0');
  await act(async () => { fireEvent.press(btn); fireEvent.press(btn); });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
});

it('"إلغاء" بينادي onPress بتاعه لو موجود، ومبينديش الفعل', async () => {
  await wrap();
  const cancel = jest.fn();
  const action = jest.fn();
  await ask([{ text: 'إلغاء', style: 'cancel', onPress: cancel }, { text: 'وقّفه', onPress: action }]);
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(action).not.toHaveBeenCalled();
});

it('"رجوع" (onRequestClose) = إلغاء', async () => {
  await wrap();
  const cancel = jest.fn();
  const action = jest.fn();
  await ask([{ text: 'إلغاء', style: 'cancel', onPress: cancel }, { text: 'حذف', style: 'destructive', onPress: action }]);
  let node: any = screen.getByTestId('confirm_dialog');
  while (node && !node.props?.onRequestClose) node = node.parent;
  expect(node).toBeTruthy();
  await act(async () => { node.props.onRequestClose(); });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(action).not.toHaveBeenCalled();
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
});

it('تأكيدين ورا بعض بيتصفوا', async () => {
  await wrap();
  await ask([{ text: 'تمام' }], 'الأول', '');
  await ask([{ text: 'تمام' }], 'التاني', '');
  expect(screen.getByTestId('confirm_title').props.children).toBe('الأول');
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('التاني');
});

it('الفعل يقدر يفتح رسالة نتيجة بعد التأكيد (notice) وهي اللي بتفضل ظاهرة', async () => {
  await wrap();
  await ask([{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive', onPress: () => noticeFn('اتمسح', 'الدين اتمسح.') }]);
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(screen.getByTestId('notice_title').props.children).toBe('اتمسح');
});

it('قارئ الشاشة: العنوان والجملة عنصر واحد، والأزرار role=button', async () => {
  await wrap();
  await ask([{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive' }]);
  expect(screen.getByLabelText('مسح الدين. هيتمسح الدين ودفعاته.')).toBeTruthy();
  expect(screen.getByTestId('confirm_action_0').props.accessibilityRole).toBe('button');
  expect(screen.getByTestId('confirm_cancel').props.accessibilityRole).toBe('button');
});

it('من غير Provider ← Alert الأصلي بنفس الأزرار', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let bare: ReturnType<typeof useConfirm> | undefined;
  function Bare() { bare = useConfirm(); return null; }
  await render(<Bare />);
  const buttons = [{ text: 'إلغاء', style: 'cancel' as const }];
  bare!('عنوان', 'جملة', buttons);
  expect(spy).toHaveBeenCalledWith('عنوان', 'جملة', buttons);
  spy.mockRestore();
});

describe('مراجعة react-reviewer', () => {
  it('H1: التطبيق اتقفل ← التأكيد المفتوح بيختفي وبيتلغي (cancel بيتنادى، والفعل لأ)', async () => {
    const r = await wrap();
    const cancel = jest.fn();
    const action = jest.fn();
    await ask([{ text: 'إلغاء', style: 'cancel', onPress: cancel }, { text: 'حذف', style: 'destructive', onPress: action }]);
    expect(screen.getByTestId('confirm_dialog')).toBeTruthy();
    mockLocked = true;
    await act(async () => { r.rerender(ui()); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it('H2: Promise مستني الإجابة بيتحل false لما القفل يلغيه (مش معلّق للأبد)', async () => {
    const r = await wrap();
    let answer: Promise<boolean> | undefined;
    await act(async () => {
      answer = new Promise<boolean>(resolve => confirmFn('أكتر من المتبقي', 'تسجّل برضه؟', [
        { text: 'إلغاء', style: 'cancel', onPress: () => resolve(false) },
        { text: 'سجّل', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) }));
    });
    mockLocked = true;
    await act(async () => { r.rerender(ui()); });
    await expect(answer).resolves.toBe(false);
  });

  it('H2: من غير زرار إلغاء، رجوع بينادي onDismiss', async () => {
    await wrap();
    const onDismiss = jest.fn();
    await act(async () => { confirmFn('عنوان', 'جملة', [{ text: 'تمام' }], { cancelable: true, onDismiss }); });
    let node: any = screen.getByTestId('confirm_dialog');
    while (node && !node.props?.onRequestClose) node = node.parent;
    await act(async () => { node.props.onRequestClose(); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a11y: الفعل الخطر ليه hint، والليبل هو النص الظاهر', async () => {
    await wrap();
    await ask([{ text: 'إلغاء', style: 'cancel' }, { text: 'حذف', style: 'destructive' }]);
    expect(screen.getByTestId('confirm_action_0').props.accessibilityHint).toBe('تأكيد فعل خطر');
  });

  it('فعلين + إلغاء ← تحت بعض', async () => {
    await wrap();
    await ask([{ text: 'إلغاء', style: 'cancel' }, { text: 'أرشفها' }, { text: 'امسحها', style: 'destructive' }]);
    let row: any = screen.getByTestId('confirm_action_0').parent;
    while (row && !(Array.isArray(row.props?.style) || row.props?.style?.flexDirection)) row = row.parent;
    const flat = require('react-native').StyleSheet.flatten(row.props.style);
    expect(flat.flexDirection).toBe('column');
  });
});

it('التباين: نص الخطر expenseText مش danger (danger كنص على nav تحت 4.5)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../components/ConfirmProvider.tsx'), 'utf8');
  expect(src).not.toMatch(/\bcolor: c\.danger\b/);
  expect(src).toMatch(/dangerText: \{ color: c\.expenseText/);
});

describe('التحقق من H1 (react-reviewer)', () => {
  it('confirm وهو مقفول ← مبيظهرش خالص، والإلغاء بيتنادى على طول', async () => {
    mockLocked = true;
    await wrap();
    const cancel = jest.fn();
    const action = jest.fn();
    await ask([{ text: 'إلغاء', style: 'cancel', onPress: cancel }, { text: 'حذف', style: 'destructive', onPress: action }]);
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it('إلغاء بيرمي ← التأكيدات التانية لسه بتتلغي', async () => {
    const r = await wrap();
    const second = jest.fn();
    await ask([{ text: 'إلغاء', style: 'cancel', onPress: () => { throw new Error('x'); } }]);
    await ask([{ text: 'إلغاء', style: 'cancel', onPress: second }]);
    mockLocked = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => { r.rerender(ui()); });
    warn.mockRestore();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
