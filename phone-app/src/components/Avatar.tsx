import React from "react";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";

import { colorHex, shapeRadius, type ShapeId } from "../lib/theme";

/** Radius for a bot's server-side avatarCrop, mirroring avatarCropRadius()
 * in shared/bot-avatar.ts: circle 50%, rounded 22%, square 0. */
function cropRadius(crop: string | undefined, size: number) {
  if (crop === "circle") return { borderRadius: size / 2 };
  if (crop === "rounded") return { borderRadius: size * 0.22 };
  if (crop === "square") return { borderRadius: 0 };
  return null; // mascot → fall through to the letter avatar
}

/**
 * Bot/room avatar. With `src` (the bot's avatarUrl through imageSource())
 * it shows the stored picture cropped the way the desktop crops it —
 * same zoom and focus point. Without a picture it draws the letter mark.
 */
export function Avatar({
  name,
  color,
  shape = "blob",
  size = 52,
  online,
  src,
  crop,
  zoom = 1,
  focusX = 0.5,
  focusY = 0.5,
}: {
  name: string;
  color?: string;
  shape?: ShapeId;
  size?: number;
  online?: boolean;
  src?: ImageSourcePropType | null;
  /** avatarCrop from the wire; only meaningful with `src`. */
  crop?: "mascot" | "circle" | "rounded" | "square";
  zoom?: number;
  focusX?: number;
  focusY?: number;
}) {
  const dotSize = Math.max(12, size * 0.26);
  const radius = src ? (cropRadius(crop, size) ?? shapeRadius(shape, size)) : shapeRadius(shape, size);

  let body: React.ReactNode;
  if (src) {
    const z = Math.min(3, Math.max(1, zoom));
    const scaled = size * z;
    // Keep (focusX, focusY) of the zoomed image centred, clamped so the
    // picture always covers the box — the same math as object-fit cover.
    const left = Math.min(0, Math.max(size - scaled, size / 2 - focusX * scaled));
    const top = Math.min(0, Math.max(size - scaled, size / 2 - focusY * scaled));
    body = (
      <View style={[{ width: size, height: size, overflow: "hidden" }, radius]}>
        <Image
          source={src}
          style={{ position: "absolute", left, top, width: scaled, height: scaled }}
        />
      </View>
    );
  } else {
    body = (
      <View style={[styles.base, radius, { width: size, height: size, backgroundColor: colorHex(color) }]}>
        <Text
          style={[
            styles.letter,
            { fontSize: size * 0.4, transform: shape === "diamond" ? [{ rotate: "-45deg" }] : undefined },
          ]}
        >
          {name.slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      {body}
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
