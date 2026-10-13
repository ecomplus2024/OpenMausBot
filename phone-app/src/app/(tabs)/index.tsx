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
import type { WireBot, WireGroup, WireMessage } from "../../lib/types";

function preview(messages: WireMessage[] | undefined, fallback: string): { text: string; at?: number } {
  const last = messages?.[messages.length - 1];
  if (!last) return { text: fallback };
  const who = last.from?.name ? `${last.from.name}: ` : "";
  if (last.kind === "activity") return { text: last.tool?.spoken || last.tool?.name || "working…", at: last.at };
  if (last.kind === "options") return { text: `${who}${last.card?.title ?? "needs an answer"}`, at: last.at };
  return { text: who + (last.text ?? ""), at: last.at };
}

function timeLabel(at?: number): string {
  if (!at) return "";
  const d = new Date(at);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

type Item = { key: string; threadId: string; at: number } & (
  | { kind: "bot"; bot: WireBot }
  | { kind: "group"; group: WireGroup }
);

function Row({ item }: { item: Item }) {
  const { marks, imageSource } = useFleet();
  const isBot = item.kind === "bot";
  const mark = isBot ? marks[item.bot.id] : undefined;
  const last = isBot
    ? preview(item.bot.messages, item.bot.description || "No messages yet")
    : preview(item.group.messages, "No messages yet");
  const name = isBot ? item.bot.name : item.group.name;
  const unread = Boolean(isBot ? item.bot.unread : item.group.unread);
  const busy = Boolean(isBot ? item.bot.busy : item.group.working);
  const title = isBot ? item.bot.title : `${item.group.memberIds.length} bots`;

  return (
    <Pressable style={styles.row} onPress={() => router.push(`/thread/${item.threadId}`)}>
      <Avatar
        name={name}
        color={isBot ? (mark?.color ?? item.bot.color) : "purple"}
        shape={isBot ? mark?.shape : "squircle"}
        size={52}
        online={busy}
        src={isBot ? imageSource(item.bot.avatarUrl) : null}
        crop={isBot ? item.bot.avatarCrop : undefined}
        zoom={isBot ? item.bot.avatarZoom : undefined}
        focusX={isBot ? item.bot.avatarFocusX : undefined}
        focusY={isBot ? item.bot.avatarFocusY : undefined}
      />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {name}
          </Text>
          {title ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {title}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {last.text}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.time, unread && styles.timeUnread]}>{timeLabel(last.at)}</Text>
        {unread ? <View style={styles.unread} /> : null}
      </View>
    </Pressable>
  );
}

export default function ChatsScreen() {
  const { bots, groups, status, refresh, unpair, serverName } = useFleet();
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

  // One messenger-style list: bots and rooms interleaved, newest first.
  // Entries without any message sink to the bottom, bots before rooms.
  const items: Item[] = [
    ...bots.map((bot) => {
      const last = bot.messages?.[bot.messages.length - 1];
      return { kind: "bot" as const, key: `b-${bot.id}`, threadId: bot.threadId, at: last?.at ?? 0, bot };
    }),
    ...groups.map((group) => {
      const last = group.messages?.[group.messages.length - 1];
      return { kind: "group" as const, key: `g-${group.id}`, threadId: group.threadId, at: last?.at ?? 0, group };
    }),
  ].sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{(serverName || "O").slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.headerTitle}>{serverName || "Chats"}</Text>
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
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={({ item }) => <Row item={item} />}
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
              <Text style={styles.hint}>No bots or rooms yet — create one on your computer.</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <ActivityIndicator />
              <Text style={styles.hint}>Loading your chats…</Text>
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
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#111" },
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
  nameUnread: { fontWeight: "800" },
  badge: {
    backgroundColor: "#f1f1f3",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: 130,
  },
  badgeText: { fontSize: 11, color: "#888" },
  preview: { color: "#8a8a8a", fontSize: 14, marginTop: 3 },
  previewUnread: { color: "#333", fontWeight: "600" },
  rowRight: { alignItems: "flex-end", gap: 6 },
  time: { fontSize: 12, color: "#b0b0b0" },
  timeUnread: { color: "#22c55e", fontWeight: "700" },
  unread: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#22c55e" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12, backgroundColor: "#fff" },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  hint: { color: "#777", textAlign: "center" },
  button: { backgroundColor: "#111", borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: "#fff", fontWeight: "600" },
  link: { padding: 8 },
  linkText: { color: "#111", textDecorationLine: "underline" },
});
