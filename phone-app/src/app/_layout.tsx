import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FleetProvider } from "../lib/store";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <FleetProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: true }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="pair" options={{ title: "Connect a computer", headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="thread/[id]" options={{ title: "" }} />
        </Stack>
      </FleetProvider>
    </SafeAreaProvider>
  );
}
