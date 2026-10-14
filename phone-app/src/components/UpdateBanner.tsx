import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { checkForUpdate, downloadAndInstall, type AvailableUpdate } from "../lib/updates";

/** Slim banner above the chat list — appears only when the GitHub release
 * asset is newer than this build. Tapping downloads then opens the system
 * installer, which asks for one confirm and "install unknown apps" once. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void checkForUpdate().then((next) => {
      if (alive) setUpdate(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!update) return null;

  const installing = progress !== null;
  return (
    <View style={styles.wrap}>
      <View style={styles.texts}>
        <Text style={styles.title}>Update available</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {failed
            ? "Install failed — download from the release page instead"
            : installing
              ? `Downloading ${Math.round(update.size / 1024 / 1024)} MB…`
              : `${Math.round(update.size / 1024 / 1024)} MB · tap Install`}
        </Text>
      </View>
      {!failed ? (
        <Pressable
          style={styles.btn}
          disabled={installing}
          onPress={() => {
            setProgress(0);
            setFailed(false);
            void downloadAndInstall(update, setProgress).catch(() => {
              setProgress(null);
              setFailed(true);
            });
          }}
        >
          {installing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Install</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: "#111",
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  texts: { flex: 1 },
  title: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sub: { color: "#b9b9bf", fontSize: 12, marginTop: 2 },
  btn: {
    backgroundColor: "#3b82f6",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 74,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
