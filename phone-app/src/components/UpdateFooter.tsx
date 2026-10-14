import Constants from "expo-constants";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { checkForUpdate, openUpdate, type AvailableUpdate } from "../lib/updates";

/** Always-visible footer under the chat list: the installed version plus a
 * manual "Check for updates". When a newer release exists it turns into an
 * install card (same action as the top banner). */
export function UpdateFooter() {
  const [checking, setChecking] = useState(false);
  const [current, setCurrent] = useState(false);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [failed, setFailed] = useState(false);

  const version = Constants.expoConfig?.version ?? "?";
  const build = Constants.expoConfig?.android?.versionCode;

  const check = async () => {
    setChecking(true);
    setCurrent(false);
    setFailed(false);
    const next = await checkForUpdate().catch(() => null);
    setChecking(false);
    if (next) setUpdate(next);
    else setCurrent(true);
  };

  if (update) {
    return (
      <View style={styles.card}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Update available</Text>
          <Text style={styles.cardSub}>{Math.round(update.size / 1024 / 1024)} MB · opens in the browser</Text>
        </View>
        <Pressable
          style={styles.install}
          onPress={() => void openUpdate(update).catch(() => setFailed(true))}
        >
          <Text style={styles.installText}>Install</Text>
        </Pressable>
        {failed ? <Text style={styles.cardSub}>Could not open the download</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.version}>
        OpenMausBot v{version}
        {build ? ` (${build})` : ""}
      </Text>
      <Pressable onPress={() => void check()} disabled={checking} hitSlop={8}>
        {checking ? (
          <ActivityIndicator size="small" color="#666" />
        ) : (
          <Text style={styles.link}>{current ? "You're up to date" : "Check for updates"}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
    backgroundColor: "#fafafa",
  },
  version: { fontSize: 12, color: "#a0a0a4" },
  link: { fontSize: 13, color: "#111", fontWeight: "600" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: "#111",
  },
  cardTitle: { color: "#fff", fontWeight: "700", fontSize: 14 },
  cardSub: { color: "#b9b9bf", fontSize: 12, marginTop: 2 },
  install: {
    backgroundColor: "#3b82f6",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  installText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
