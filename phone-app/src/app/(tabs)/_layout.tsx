import { Tabs } from "expo-router";
import React from "react";
import { Text } from "react-native";

import { useFleet } from "../../lib/store";

function Dot({ on }: { on: boolean }) {
  return (
    <Text style={{ color: on ? "#3ba55d" : "#999", fontSize: 10 }}>{on ? "●" : "○"}</Text>
  );
}

export default function TabsLayout() {
  const { serverName, connected } = useFleet();
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: "left",
        headerRight: () => <Dot on={connected} />,
        headerRightContainerStyle: { paddingRight: 16 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: serverName || "Bots",
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
