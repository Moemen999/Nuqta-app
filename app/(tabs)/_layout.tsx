import { router, Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/context/ThemeContext';

export default function TabLayout() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: { backgroundColor: colors.nav, borderTopColor: colors.border },
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarLabelStyle: { fontSize: 10 },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'الرئيسية',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="house.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'التقارير',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="chart.pie.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="planning"
          options={{
            title: 'التخطيط',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="banknote.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="debts"
          options={{
            title: 'الديون',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="person.2.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'الإعدادات',
            tabBarIcon: ({ color }) => <IconSymbol size={22} name="gearshape.fill" color={color} />,
          }}
        />
      </Tabs>

      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.accent }]} onPress={() => router.push('/modal')}>
        <Text style={[styles.fabText, { color: colors.onAccent }]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', bottom: 90, alignSelf: 'center', width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabText: { fontSize: 28, fontWeight: '700', marginTop: -2 },
});