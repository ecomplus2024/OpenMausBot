import { Stack } from "expo-router";
import React from "react";

// Single merged chat list — no tab bar. The (tabs) group name is kept
// so "/(tabs)" deep links from the pair flow still resolve to index.
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
