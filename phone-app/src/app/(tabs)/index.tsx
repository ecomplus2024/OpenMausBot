import { Link, router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useFleet } from "../../lib/store";
import type { WireBot } from "../../lib/types";

function preview(bot: WireBot): string {
  const last = bot.messages?.[bot.messages.length - 1];
  if (!last) return bot.description || "No messages yet";
  if (last.kind === "activity") return last.tool?.spoken || last.tool?.name || "working…";
  if (last.kind === "options") return last.card?.title ?? "needs an answer";
  return last.text ?? "";
}

function Row({ bot }: { bot: WireBot }) {
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${bot.threadId}`)}>
      <View style={[styles.avatar, { backgroundColor: bot.color ?? "#888" }]}>
        <Text style={styles.avatarText}>{bot.name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {bot.name}
          </Text>
          {bot.busy ? <Text style={styles.busy}>working…</Text> : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview(bot)}
        </Text>
      </View>
      {bot.unread ? <View style={styles.unread} /> : null}
    </Pressable>
  );
}

export default function BotsScreen() {
  const { bots, status, refresh, unpair, serverName } = useFleet();
  const [refreshing, setRefreshing] = React.useState(false);

  if (status === "offline") {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{serverName || "Computer"} is unreachable</Text>
        <Text style={styles.hint}>Make sure the computer is awake and OpenMausBot is running.</Text>
        <Pressable style={styles.button} onPress={() => void refresh()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
        <Pressable style={styles.link} onPress={() => void unpair()}>
          <Text style={styles.linkText}>Forget this computer</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={bots}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => <Row bot={item} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <ActivityIndicator />
            <Text style={styles.hint}>Loading your bots…</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
      <Link href="/pair" asChild>
        <Pressable style={styles.repair}>
          <Text style={styles.repairText}>Pair another computer</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  busy: { fontSize: 12, color: "#0b6bcb" },
  preview: { color: "#666", marginTop: 2 },
  unread: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#0b6bcb" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: "#e5e5e5", marginLeft: 70 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  hint: { color: "#777", textAlign: "center" },
  button: { backgroundColor: "#0b6bcb", borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: "#fff", fontWeight: "600" },
  link: { padding: 8 },
  linkText: { color: "#0b6bcb" },
  repair: { padding: 14, alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#e5e5e5" },
  repairText: { color: "#0b6bcb" },
});
