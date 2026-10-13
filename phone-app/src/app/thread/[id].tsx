import { Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFleet } from "../../lib/store";
import type { OptionCardData, WireMessage } from "../../lib/types";

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Approval/question card: options become buttons; a live request answers
 * through /respond, a passive card replies with the option text. */
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
        <>
          <View style={styles.cardOptions}>
            {card.options.map((option) => (
              <Pressable key={option} style={styles.cardOption} onPress={() => onAnswer(option)}>
                <Text style={styles.cardOptionText}>{option}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onDismiss} style={styles.cardDismiss}>
            <Text style={styles.cardDismissText}>Dismiss</Text>
          </Pressable>
        </>
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
  const { threads, bots, groups, openThread, loadOlder, sendText, interrupt, markRead, answerCard, dismissCard } =
    useFleet();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const thread = threads[threadId];
  const owner =
    bots.find((b) => b.threadId === threadId || b.tasks?.some((t) => t.threadId === threadId)) ??
    groups.find((g) => g.threadId === threadId || g.tasks?.some((t) => t.threadId === threadId));
  const title = "name" in (owner ?? {}) ? (owner as { name?: string }).name : "Chat";
  const busy = Boolean(
    owner && ("busy" in owner ? owner.busy : false) || (owner && "working" in owner ? owner.working : false),
  );

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <Stack.Screen
        options={{
          title: title || "Chat",
          headerRight: busy
            ? () => (
                <Pressable onPress={() => void interrupt(threadId)} style={styles.stop}>
                  <Text style={styles.stopText}>■ Stop</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
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
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message…"
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={!sending}
        />
        <Pressable style={[styles.send, (!draft.trim() || sending) && styles.sendOff]} onPress={() => void send()}>
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f6f6f8" },
  list: { paddingVertical: 8 },
  loading: { position: "absolute", top: 12, alignSelf: "center" },
  line: { paddingHorizontal: 12, marginVertical: 3 },
  lineMine: { alignItems: "flex-end" },
  lineBot: { alignItems: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: "#0b6bcb", borderBottomRightRadius: 4 },
  bubbleBot: { backgroundColor: "#fff", borderBottomLeftRadius: 4 },
  from: { fontSize: 11, fontWeight: "700", color: "#5b54c7", marginBottom: 2 },
  text: { fontSize: 15, color: "#111" },
  textMine: { color: "#fff" },
  time: { fontSize: 10, color: "#999", marginTop: 3, alignSelf: "flex-end" },
  timeMine: { color: "#cfe3f8" },
  activity: { fontSize: 12, color: "#8a8a8a", fontStyle: "italic" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    maxWidth: "90%",
    borderWidth: 1,
    borderColor: "#e3d9ff",
  },
  cardSettled: { opacity: 0.65 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSubtitle: { fontSize: 13, color: "#555", marginTop: 4 },
  cardOptions: { marginTop: 10, gap: 8 },
  cardOption: {
    backgroundColor: "#f0eafd",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  cardOptionText: { color: "#4a3ea8", fontWeight: "600" },
  cardDismiss: { marginTop: 8, alignSelf: "flex-end" },
  cardDismissText: { color: "#999", fontSize: 13 },
  cardAnswered: { marginTop: 8, color: "#3ba55d", fontWeight: "600" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    gap: 8,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 20,
    backgroundColor: "#f0f0f2",
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#0b6bcb",
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { backgroundColor: "#b8c9dd" },
  sendText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  stop: { paddingHorizontal: 10, paddingVertical: 6 },
  stopText: { color: "#d64545", fontWeight: "700" },
});
