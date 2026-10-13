import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useFleet } from "../lib/store";

export default function Bootstrap() {
  const { status } = useFleet();

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (status === "unpaired") return <Redirect href="/pair" />;
  return <Redirect href="/(tabs)" />;
}
