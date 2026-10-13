import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../../components/Avatar";
import { useFleet } from "../../lib/store";
import { SHAPES, SWATCHES, type ShapeId } from "../../lib/theme";

/** Per-bot profile: identity + the mark (color/shape) shown across the app.
 * Marks are device-local — the companion API cannot write a bot's color. */
export default function BotProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bots, marks, setMark, imageSource } = useFleet();
  const insets = useSafeAreaInsets();
  const bot = bots.find((b) => b.id === id);

  if (!bot) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.missing}>This bot is gone from the fleet.</Text>
      </View>
    );
  }

  const mark = marks[bot.id];
  const color = mark?.color ?? bot.color;
  const shape = mark?.shape ?? "blob";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Avatar
            name={bot.name}
            color={color}
            shape={shape}
            size={96}
            online={bot.busy}
            src={imageSource(bot.avatarUrl)}
            crop={bot.avatarCrop}
            zoom={bot.avatarZoom}
            focusX={bot.avatarFocusX}
            focusY={bot.avatarFocusY}
          />
          <Text style={styles.name}>{bot.name}</Text>
          {bot.title ? <Text style={styles.title}>{bot.title}</Text> : null}
          {bot.description ? <Text style={styles.description}>{bot.description}</Text> : null}
        </View>

        <Text style={styles.section}>Mark</Text>
        <Text style={styles.caption}>Color — picked on this phone, not synced</Text>
        <View style={styles.swatches}>
          {SWATCHES.map((hex) => (
            <Pressable
              key={hex}
              onPress={() => setMark(bot.id, { color: hex })}
              style={[styles.swatch, { backgroundColor: hex }, color === hex && styles.swatchOn]}
            />
          ))}
        </View>
        <Text style={styles.caption}>Shape</Text>
        <View style={styles.shapesRow}>
          {SHAPES.map((s: ShapeId) => (
            <Pressable
              key={s}
              onPress={() => setMark(bot.id, { shape: s })}
              style={[styles.shapeCell, shape === s && styles.shapeCellOn]}
            >
              <Avatar name={bot.name} color={color} shape={s} size={40} />
            </Pressable>
          ))}
        </View>

        {bot.tasks?.length ? (
          <>
            <Text style={styles.section}>Tasks</Text>
            {bot.tasks.map((t) => (
              <Pressable
                key={t.threadId}
                style={styles.taskRow}
                onPress={() => router.push(`/thread/${t.threadId}`)}
              >
                <Text style={styles.taskText} numberOfLines={1}>
                  {t.title || t.threadId}
                </Text>
                <Text style={styles.taskChevron}>›</Text>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: { paddingHorizontal: 8, paddingVertical: 4 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 30, color: "#111" },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  hero: { alignItems: "center", paddingVertical: 16, gap: 6 },
  name: { fontSize: 22, fontWeight: "700", color: "#111" },
  title: { fontSize: 14, color: "#8a8a8a" },
  description: { fontSize: 13, color: "#9a9a9e", textAlign: "center", marginTop: 4 },
  section: { fontSize: 16, fontWeight: "700", color: "#111", marginTop: 24, marginBottom: 10 },
  caption: { fontSize: 12, color: "#9a9a9e", marginBottom: 8 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  swatchOn: { borderWidth: 3, borderColor: "#111" },
  shapesRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  shapeCell: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6f6f8",
  },
  shapeCellOn: { borderWidth: 2, borderColor: "#111" },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
  },
  taskText: { flex: 1, fontSize: 15, color: "#111" },
  taskChevron: { fontSize: 20, color: "#bbb" },
  missing: { textAlign: "center", marginTop: 80, color: "#777" },
});
