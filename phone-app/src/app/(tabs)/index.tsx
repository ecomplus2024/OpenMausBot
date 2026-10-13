import { Link, Redirect, router } from "expo-router";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../../components/Avatar";
import { useFleet } from "../../lib/store";
import type { WireBot } from "../../lib/types";

function preview(bot: WireBot): string {
  const last = bot.messages?.[bot.messages.length - 1];
  if (!last) return bot.description || "No messages yet";
  if (last.kind === "activity") return last.tool?.spoken || last.tool?.name || "working…";
  if (last.kind === "options") return last.card?.title ?? "needs an answer";
  return last.text ?? "";
}

function timeLabel(at?: number): string {
  if (!at) return "";
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function Row({ bot }: { bot: WireBot }) {
  const { marks, imageSource } = useFleet();
  const mark = marks[bot.id];
  const last = bot.messages?.[bot.messages.length - 1];
  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${bot.threadId}`)}>
      <Avatar
        name={bot.name}
        color={mark?.color ?? bot.color}
        shape={mark?.shape}
        size={52}
        online={bot.busy}
        src={imageSource(bot.avatarUrl)}
        crop={bot.avatarCrop}
        zoom={bot.avatarZoom}
        focusX={bot.avatarFocusX}
        focusY={bot.avatarFocusY}
      />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {bot.name}
          </Text>
          {bot.title ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {bot.title}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview(bot)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.time}>{timeLabel(last?.at)}</Text>
        {bot.unread ? <View style={styles.unread} /> : null}
      </View>
    </Pressable>
  );
}

export default function BotsScreen() {
  const { bots, status, refresh, unpair, serverName } = useFleet();
  const [refreshing, setRefreshing] = React.useState(false);
  const insets = useSafeAreaInsets();

  if (status === "unpaired") return <Redirect href="/pair" />;

  if (status === "offline") {
    return (
      <View style={[styles.empty, { paddingTop: insets.top }]}>
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{(serverName || "O").slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.headerBtn} onPress={() => void refresh()}>
          <Text style={styles.headerBtnText}>⌕</Text>
        </Pressable>
        <Link href="/pair" asChild>
          <Pressable style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>＋</Text>
          </Pressable>
        </Link>
      </View>
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
          status === "paired" ? (
            <View style={styles.empty}>
              <Text style={styles.hint}>No bots yet — create one on your computer.</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <ActivityIndicator />
              <Text style={styles.hint}>Loading your bots…</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f4f4f5",
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnText: { fontSize: 20, color: "#333" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontWeight: "600", color: "#111", flexShrink: 1 },
  badge: {
    backgroundColor: "#f1f1f3",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: 130,
  },
  badgeText: { fontSize: 11, color: "#888" },
  preview: { color: "#8a8a8a", fontSize: 14, marginTop: 3 },
  rowRight: { alignItems: "flex-end", gap: 6 },
  time: { fontSize: 12, color: "#b0b0b0" },
  unread: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#22c55e" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12, backgroundColor: "#fff" },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  hint: { color: "#777", textAlign: "center" },
  button: { backgroundColor: "#111", borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: "#fff", fontWeight: "600" },
  link: { padding: 8 },
  linkText: { color: "#111", textDecorationLine: "underline" },
});
