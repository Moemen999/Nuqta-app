import React, { useState } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConfirmProvider, useConfirm, useConfirmDismiss } from '@/components/ConfirmProvider';
import { LEAVE_CONFIRM_KEY, LeaveUnsaved } from '@/components/LeaveUnsaved';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * سؤال «تخرج؟» القديم بيتشال (الميزة 10، a11y-architect): الشاشة اتشالت أو `when` بقى false والسؤال لسه في الطابور —
 * كان بيظهر بعدين على شاشة تانية، و«اخرج» كان هيرجع خطوة زيادة.
 */
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));

describe('useConfirmDismiss', () => {
  function Host() {
    const confirm = useConfirm();
    const dismiss = useConfirmDismiss();
    return (
      <>
        <Text onPress={() => confirm('أ', 'ب', [{ text: 'لأ', style: 'cancel' }, { text: 'أيوه' }], { key: 'k' })}>اسأل</Text>
        <Text onPress={() => confirm('ج', 'د', [{ text: 'لأ', style: 'cancel' }, { text: 'أيوه' }])}>اسأل تاني</Text>
        <Text onPress={() => dismiss('k')}>شيل</Text>
      </>
    );
  }
  it('بيشيل التأكيد اللي بالـkey بس — والباقي فاضل', async () => {
    await render(<ThemeProvider><ConfirmProvider><Host /></ConfirmProvider></ThemeProvider>);
    await act(async () => { fireEvent.press(screen.getByText('اسأل')); });
    await act(async () => { fireEvent.press(screen.getByText('اسأل تاني')); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('أ');
    await act(async () => { fireEvent.press(screen.getByText('شيل')); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('ج');
  });
  it('من غير Provider ← ولا حاجة (مبيرميش)', async () => {
    let d: ReturnType<typeof useConfirmDismiss> | null = null;
    function Probe() { d = useConfirmDismiss(); return null; }
    await render(<Probe />);
    expect(() => d!('x')).not.toThrow();
  });
});

describe('LeaveUnsaved', () => {
  const navRef = createNavigationContainerRef<any>();
  const Stack = createNativeStackNavigator();
  let setWhen: (v: boolean) => void = () => {};
  function Form() {
    const confirm = useConfirm();
    const [when, set] = useState(true);
    setWhen = set;
    return (
      <LeaveUnsaved when={when} ask={proceed => confirm('تخرج؟', '', [
        { text: 'كمّل الكتابة', style: 'cancel' }, { text: 'اخرج من غير حفظ', style: 'destructive', onPress: proceed },
      ], { key: LEAVE_CONFIRM_KEY })} />
    );
  }
  const Home = () => <Text>الرئيسية</Text>;
  async function open() {
    await render(
      <ThemeProvider><ConfirmProvider>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator>
            <Stack.Screen name="home" component={Home} />
            <Stack.Screen name="form" component={Form} />
          </Stack.Navigator>
        </NavigationContainer>
      </ConfirmProvider></ThemeProvider>,
    );
    await act(async () => { navRef.navigate('form'); });
  }

  it('السؤال مفتوح و`when` بقى false (الحفظ بدأ) ← السؤال بيتشال', async () => {
    await open();
    await act(async () => { navRef.goBack(); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('تخرج؟');
    await act(async () => { setWhen(false); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  });
});
