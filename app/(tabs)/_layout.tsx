import { router, Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
          tabBarButton: HapticTab,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'الرئيسية',
            tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
          }}
        />
       <Tabs.Screen
  name="reports"
  options={{
    title: 'التقارير',
    tabBarIcon: ({ color }) => <IconSymbol size={26} name="chart.pie.fill" color={color} />,
  }}
/>
<Tabs.Screen
  name="budget"
  options={{
    title: 'الميزانية',
    tabBarIcon: ({ color }) => <IconSymbol size={26} name="banknote.fill" color={color} />,
  }}
/>
<Tabs.Screen
  name="settings"
  options={{
    title: 'الإعدادات',
    tabBarIcon: ({ color }) => <IconSymbol size={26} name="gearshape.fill" color={color} />,
  }}
/>
      </Tabs>

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/modal')}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 90,
    alignSelf: 'center',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#C9A961',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: '#0B0D10', fontSize: 30, fontWeight: '700', marginTop: -2 },
});