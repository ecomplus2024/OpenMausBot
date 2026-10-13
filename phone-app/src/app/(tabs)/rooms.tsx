import { router } from "expo-router";
import React from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../../components/Avatar";
import { useFleet } from "../../lib/store";
import type { WireGroup } from "../../lib/types";

function preview(group: WireGroup): string {
  const last = group.messages?.[group.messages.length - 1];
  if (!last) return "No messages yet";
  const who = last.from?.name ? `${last.from.name}: ` : "";
  if (last.kind === "options") return `${who}${last.card?.title ?? "needs an answer"}`;
  return who + (last.text ?? last.tool?.spoken ?? "");
}

function timeLabel(at?: number): string {
  if (!at) return "";
  const d = new Date(at);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function Row({ group }: { group: WireGroup }) {
  const last = group.messages?.[group.messages.length - 1];
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${group.threadId}`)}>
      <Avatar name={group.name} color="purple" shape="squircle" size={52} online={group.working} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {group.name}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{group.memberIds.length} bots</Text>
          </View>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview(group)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.time}>{timeLabel(last?.at)}</Text>
        {group.unread ? <View style={styles.unread} /> : null}
      </View>
    </Pressable>
  );
}

export default function RoomsScreen() {
  const { groups, refresh } = useFleet();
  const [refreshing, setRefreshing] = React.useState(false);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.header}>Rooms</Text>
      <FlatList
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { fontSize: 22, fontWeight: "700", paddingHorizontal: 16, paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontWeight: "600", color: "#111", flexShrink: 1 },
  badge: { backgroundColor: "#f1f1f3", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, color: "#888" },
  preview: { color: "#8a8a8a", fontSize: 14, marginTop: 3 },
  rowRight: { alignItems: "flex-end", gap: 6 },
  time: { fontSize: 12, color: "#b0b0b0" },
  unread: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#22c55e" },
  empty: { alignItems: "center", padding: 32 },
  hint: { color: "#777", textAlign: "center" },
});
