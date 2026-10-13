import { router } from "expo-router";
import React from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { useFleet } from "../../lib/store";
import type { WireGroup } from "../../lib/types";

function preview(group: WireGroup): string {
  const last = group.messages?.[group.messages.length - 1];
  if (!last) return "No messages yet";
  const who = last.from?.name ? `${last.from.name}: ` : "";
  if (last.kind === "options") return `${who}${last.card?.title ?? "needs an answer"}`;
  return who + (last.text ?? last.tool?.spoken ?? "");
}

function Row({ group }: { group: WireGroup }) {
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${group.threadId}`)}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{group.name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.members}>{group.memberIds.length} bots</Text>
          {group.working ? <Text style={styles.busy}>working…</Text> : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview(group)}
        </Text>
      </View>
      {group.unread ? <View style={styles.unread} /> : null}
    </Pressable>
  );
}

export default function RoomsScreen() {
  const { groups, refresh } = useFleet();
  const [refreshing, setRefreshing] = React.useState(false);
  return (
    <FlatList
      style={styles.container}
      data={groups}
      keyExtractor={(g) => g.id}
      renderItem={({ item }) => <Row group={item} />}
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
          <Text style={styles.hint}>No rooms yet — create one on your computer.</Text>
        </View>
      }
      ItemSeparatorComponent={() => <View style={styles.sep} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#5b54c7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontWeight: "600", flexShrink: 1 },
  members: { fontSize: 12, color: "#999" },
  busy: { fontSize: 12, color: "#0b6bcb" },
  preview: { color: "#666", marginTop: 2 },
  unread: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#0b6bcb" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: "#e5e5e5", marginLeft: 70 },
  empty: { alignItems: "center", padding: 32 },
  hint: { color: "#777", textAlign: "center" },
});
