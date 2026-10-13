import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colorHex, shapeRadius, type ShapeId } from "../lib/theme";

/** Letter avatar in the bot's mark shape, with an optional presence dot. */
export function Avatar({
  name,
  color,
  shape = "blob",
  size = 52,
  online,
}: {
  name: string;
  color?: string;
  shape?: ShapeId;
  size?: number;
  online?: boolean;
}) {
  const radius = shapeRadius(shape, size);
  const dotSize = Math.max(12, size * 0.26);
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.base, radius, { width: size, height: size, backgroundColor: colorHex(color) }]}>
        <Text style={[styles.letter, { fontSize: size * 0.4, transform: shape === "diamond" ? [{ rotate: "-45deg" }] : undefined }]}>
          {name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      {online ? <View style={[styles.dot, { width: dotSize, height: dotSize, borderRadius: dotSize / 2 }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  letter: { color: "#fff", fontWeight: "700" },
  dot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    backgroundColor: "#22c55e",
    borderWidth: 2,
    borderColor: "#fff",
  },
});
