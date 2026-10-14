import { Redirect, router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../../components/Avatar";
import { UpdateBanner } from "../../components/UpdateBanner";
import { UpdateFooter } from "../../components/UpdateFooter";
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

/** "+" sheet: New bot / New room — the companion relays these creates with
 * loopback authority (POST /api/bots, /api/groups are phone-allowed). */
function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { bots, createBot, createRoom } = useFleet();
  const [mode, setMode] = React.useState<"menu" | "bot" | "room">("menu");
  const [name, setName] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const reset = () => {
    setMode("menu");
    setName("");
    setPicked(new Set());
    setBusy(false);
    setError("");
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "bot") await createBot(name.trim());
      else await createRoom(name.trim(), [...picked]);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create it");
      setBusy(false);
    }
  };

  const canCreate = mode === "bot" ? name.trim().length > 0 : picked.size > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={sheet.backdrop} onPress={close}>
        <Pressable style={sheet.card} onPress={(e) => e.stopPropagation()}>
          {mode === "menu" ? (
            <>
              <Text style={sheet.title}>New</Text>
              <Pressable style={sheet.option} onPress={() => setMode("bot")}>
                <Text style={sheet.optionIcon}>◉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={sheet.optionTitle}>New bot</Text>
                  <Text style={sheet.optionSub}>A bot with its own chat</Text>
                </View>
              </Pressable>
              <Pressable style={sheet.option} onPress={() => setMode("room")}>
                <Text style={sheet.optionIcon}>◈</Text>
                <View style={{ flex: 1 }}>
                  <Text style={sheet.optionTitle}>New room</Text>
                  <Text style={sheet.optionSub}>Several bots working together</Text>
                </View>
              </Pressable>
              <View style={sheet.divider} />
              <Pressable
                style={sheet.option}
                onPress={() => {
                  close();
                  router.push("/pair");
                }}
              >
                <Text style={sheet.optionIcon}>⌁</Text>
                <View style={{ flex: 1 }}>
                  <Text style={sheet.optionTitle}>Pair another computer</Text>
                  <Text style={sheet.optionSub}>QR code or a 6-digit code</Text>
                </View>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={sheet.title}>{mode === "bot" ? "New bot" : "New room"}</Text>
              <TextInput
                style={sheet.input}
                placeholder={mode === "bot" ? "Bot name" : "Room name (optional)"}
                placeholderTextColor="#9a9a9e"
                value={name}
                onChangeText={setName}
                autoFocus
              />
              {mode === "room" ? (
                <View style={sheet.members}>
                  <Text style={sheet.membersLabel}>Bots in this room</Text>
                  {bots.map((bot) => {
                    const on = picked.has(bot.id);
                    return (
                      <Pressable
                        key={bot.id}
                        style={sheet.memberRow}
                        onPress={() =>
                          setPicked((s) => {
                            const next = new Set(s);
                            if (next.has(bot.id)) next.delete(bot.id);
                            else next.add(bot.id);
                            return next;
                          })
                        }
                      >
                        <View style={[sheet.check, on && sheet.checkOn]}>
                          {on ? <Text style={sheet.checkMark}>✓</Text> : null}
                        </View>
                        <Text style={sheet.memberName} numberOfLines={1}>
                          {bot.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {!bots.length ? <Text style={sheet.optionSub}>No bots yet — create one first.</Text> : null}
                </View>
              ) : null}
              {error ? <Text style={sheet.error}>{error}</Text> : null}
              <View style={sheet.actions}>
                <Pressable style={sheet.cancel} onPress={close} disabled={busy}>
                  <Text style={sheet.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[sheet.create, !canCreate && sheet.createOff]}
                  onPress={() => void submit()}
                  disabled={!canCreate || busy}
                >
                  {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={sheet.createText}>Create</Text>}
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function ChatsScreen() {
  const { bots, groups, status, refresh, unpair, serverName } = useFleet();
  const [refreshing, setRefreshing] = React.useState(false);
  const [sheet, setSheet] = React.useState(false);
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
        <Pressable style={styles.headerBtn} onPress={() => setSheet(true)}>
          <Text style={styles.headerBtnText}>＋</Text>
        </Pressable>
      </View>
      <UpdateBanner />
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
              <Text style={styles.hint}>No bots or rooms yet — tap ＋ to create one.</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <ActivityIndicator />
              <Text style={styles.hint}>Loading your chats…</Text>
            </View>
          )
        }
      />
      <UpdateFooter />
      <CreateSheet visible={sheet} onClose={() => setSheet(false)} />
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

const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  card: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 28,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#111", marginBottom: 12 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 },
  optionIcon: {
    width: 42,
    textAlign: "center",
    fontSize: 22,
    color: "#111",
    backgroundColor: "#f4f4f5",
    borderRadius: 21,
    overflow: "hidden",
    paddingVertical: 8,
  },
  optionTitle: { fontSize: 15, fontWeight: "600", color: "#111" },
  optionSub: { fontSize: 12, color: "#888", marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e8e8ea", marginVertical: 6 },
  input: {
    borderRadius: 12,
    backgroundColor: "#f4f4f5",
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: "#111",
  },
  members: { marginTop: 14, gap: 2, maxHeight: 240 },
  membersLabel: { fontSize: 12, fontWeight: "600", color: "#888", marginBottom: 6, textTransform: "uppercase" },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#c9c9cd",
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: "#111", borderColor: "#111" },
  checkMark: { color: "#fff", fontSize: 12, fontWeight: "700" },
  memberName: { fontSize: 15, color: "#111", flex: 1 },
  error: { color: "#d64545", fontSize: 13, marginTop: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  cancel: { paddingHorizontal: 16, paddingVertical: 10 },
  cancelText: { color: "#666", fontWeight: "600", fontSize: 14 },
  create: {
    backgroundColor: "#111",
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 10,
    minWidth: 90,
    alignItems: "center",
  },
  createOff: { backgroundColor: "#c9c9cd" },
  createText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
