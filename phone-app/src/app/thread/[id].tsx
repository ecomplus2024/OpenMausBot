import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../../components/Avatar";
import { useFleet } from "../../lib/store";
import type { OptionCardData, WireMessage } from "../../lib/types";

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Approval/question card: first option is the primary (dark) action, the
 * rest are secondary — the same choice hierarchy the desktop draws. */
function CardView({
  card,
  onAnswer,
  onDismiss,
}: {
  card: OptionCardData;
  onAnswer: (option: string) => void;
  onDismiss: () => void;
}) {
  const answered = Boolean(card.answered || card.dismissed || card.expired);
  return (
    <View style={[styles.card, answered && styles.cardSettled]}>
      <Text style={styles.cardTitle}>{card.title}</Text>
      {card.subtitle ? <Text style={styles.cardSubtitle}>{card.subtitle}</Text> : null}
      {answered ? (
        <Text style={styles.cardAnswered}>
          {card.answeredText ?? card.answered ?? (card.expired ? "Expired" : "Dismissed")}
        </Text>
      ) : (
        <View style={styles.cardOptions}>
          {card.options.map((option, i) => (
            <Pressable
              key={option}
              style={[styles.cardOption, i === 0 ? styles.cardOptionPrimary : styles.cardOptionSecondary]}
              onPress={() => onAnswer(option)}
            >
              <Text style={i === 0 ? styles.cardOptionTextPrimary : styles.cardOptionTextSecondary}>
                {option}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={onDismiss} style={styles.cardDismiss}>
            <Text style={styles.cardDismissText}>Dismiss</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Row({
  message,
  onAnswer,
  onDismiss,
}: {
  message: WireMessage;
  onAnswer: (option: string) => void;
  onDismiss: () => void;
}) {
  const mine = message.role === "user";
  if (message.kind === "options" && message.card) {
    return (
      <View style={[styles.line, styles.lineBot]}>
        <CardView card={message.card} onAnswer={onAnswer} onDismiss={onDismiss} />
      </View>
    );
  }
  if (message.kind === "activity") {
    return (
      <View style={[styles.line, styles.lineBot]}>
        <Text style={styles.activity}>
          ⚙ {message.tool?.spoken || message.tool?.name || "activity"}
          {message.tool?.ok === false ? " — failed" : ""}
        </Text>
      </View>
    );
  }
  if (message.kind === "digest" || message.kind === "compaction") {
    return null; // bookkeeping rows add noise on a phone; the reply follows
  }
  return (
    <View style={[styles.line, mine ? styles.lineMine : styles.lineBot]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleBot]}>
        {message.from ? <Text style={styles.from}>{message.from.name}</Text> : null}
        <Text style={[styles.text, mine && styles.textMine]}>{message.text ?? ""}</Text>
        <Text style={[styles.time, mine && styles.timeMine]}>{time(message.at)}</Text>
      </View>
    </View>
  );
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = String(id);
  const {
    threads, bots, groups, marks, imageSource,
    openThread, loadOlder, sendText, interrupt, markRead, answerCard, dismissCard,
  } = useFleet();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const insets = useSafeAreaInsets();

  const thread = threads[threadId];
  const owner =
    bots.find((b) => b.threadId === threadId || b.tasks?.some((t) => t.threadId === threadId)) ??
    groups.find((g) => g.threadId === threadId || g.tasks?.some((t) => t.threadId === threadId));
  const title = "name" in (owner ?? {}) ? (owner as { name?: string }).name : "Chat";
  const busy = Boolean(
    owner && ("busy" in owner ? owner.busy : false) || (owner && "working" in owner ? owner.working : false),
  );
  const botId = owner && "id" in owner && bots.some((b) => b.id === owner.id) ? owner.id : null;
  const mark = botId ? marks[botId] : undefined;

  useEffect(() => {
    void openThread(threadId).then(() => markRead(threadId)).catch(() => {});
  }, [threadId, openThread, markRead]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      await sendText(threadId, text);
    } catch {
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [draft, sending, sendText, threadId]);

  const data = useMemo(() => [...(thread?.messages ?? [])].reverse(), [thread?.messages]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <Text style={styles.headerIcon}>‹</Text>
        </Pressable>
        <Pressable
          style={styles.headerCenter}
          onPress={() => botId && router.push(`/bot/${botId}`)}
          disabled={!botId}
        >
          <Avatar
            name={title || "C"}
            color={mark?.color ?? (owner as { color?: string })?.color}
            shape={mark?.shape}
            size={32}
            src={imageSource((owner as { avatarUrl?: string | null })?.avatarUrl)}
            crop={(owner as { avatarCrop?: "mascot" | "circle" | "rounded" | "square" })?.avatarCrop}
            zoom={(owner as { avatarZoom?: number })?.avatarZoom}
            focusX={(owner as { avatarFocusX?: number })?.avatarFocusX}
            focusY={(owner as { avatarFocusY?: number })?.avatarFocusY}
          />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title || "Chat"}
          </Text>
        </Pressable>
        {busy ? (
          <Pressable onPress={() => void interrupt(threadId)} style={styles.headerBtn} hitSlop={8}>
            <Text style={styles.stopText}>■</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Edge-to-edge (forced on Android 15) disables adjustResize's window
       * shrink, so the IME inset must be consumed in JS — keyboard-controller's
       * KAV tracks the keyboard natively on both platforms. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <Row
              message={item}
              onAnswer={(option) => void answerCard(threadId, item.card!, option).catch(() => {})}
              onDismiss={() => void dismissCard(threadId, item.card!).catch(() => {})}
            />
          )}
          onEndReached={() => void loadOlder(threadId)}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            thread?.hasMore ? <ActivityIndicator style={{ margin: 12 }} /> : null
          }
          contentContainerStyle={styles.list}
        />
        {!thread?.loaded ? <ActivityIndicator style={styles.loading} /> : null}
        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            placeholder={`Ask ${title || "the bot"}`}
            placeholderTextColor="#9a9a9e"
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!sending}
          />
          <Pressable style={[styles.send, (!draft.trim() || sending) && styles.sendOff]} onPress={() => void send()}>
            <Text style={styles.sendText}>➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
    gap: 4,
  },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerIcon: { fontSize: 24, color: "#111" },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#111", flexShrink: 1 },
  stopText: { fontSize: 16, color: "#d64545", fontWeight: "700" },
  list: { paddingVertical: 8 },
  loading: { position: "absolute", top: 12, alignSelf: "center" },
  line: { paddingHorizontal: 12, marginVertical: 3 },
  lineMine: { alignItems: "flex-end" },
  lineBot: { alignItems: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMine: { backgroundColor: "#111", borderBottomRightRadius: 6 },
  bubbleBot: { backgroundColor: "#f1f1f3", borderBottomLeftRadius: 6 },
  from: { fontSize: 11, fontWeight: "700", color: "#8b5cf6", marginBottom: 2 },
  text: { fontSize: 15, color: "#111", lineHeight: 21 },
  textMine: { color: "#fff" },
  time: { fontSize: 10, color: "#9a9a9e", marginTop: 3, alignSelf: "flex-end" },
  timeMine: { color: "#8f8f96" },
  activity: { fontSize: 12, color: "#8a8a8a", fontStyle: "italic" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    maxWidth: "90%",
    borderWidth: 1,
    borderColor: "#e8e8ea",
  },
  cardSettled: { opacity: 0.65 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#111" },
  cardSubtitle: { fontSize: 13, color: "#666", marginTop: 4, lineHeight: 19 },
  cardOptions: { marginTop: 12, gap: 8 },
  cardOption: { borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  cardOptionPrimary: { backgroundColor: "#111" },
  cardOptionSecondary: { backgroundColor: "#f1f1f3" },
  cardOptionTextPrimary: { color: "#fff", fontWeight: "600", fontSize: 14 },
  cardOptionTextSecondary: { color: "#111", fontWeight: "600", fontSize: 14 },
  cardDismiss: { alignSelf: "center", paddingVertical: 4 },
  cardDismissText: { color: "#999", fontSize: 13 },
  cardAnswered: { marginTop: 8, color: "#22c55e", fontWeight: "600" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 8,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e8e8ea",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 22,
    backgroundColor: "#f1f1f3",
    paddingHorizontal: 16,
    paddingVertical: 9,
    fontSize: 15,
    color: "#111",
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { backgroundColor: "#c9c9cd" },
  sendText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
