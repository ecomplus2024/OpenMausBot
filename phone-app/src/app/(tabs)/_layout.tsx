import { Tabs } from "expo-router";
import React from "react";
import { Text } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#111",
        tabBarInactiveTintColor: "#aaa",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Bots",
          tabBarLabel: "Bots",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🤖</Text>,
        }}
      />
      <Tabs.Screen
        name="rooms"
        options={{
          title: "Rooms",
          tabBarLabel: "Rooms",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👥</Text>,
        }}
      />
    </Tabs>
  );
}
