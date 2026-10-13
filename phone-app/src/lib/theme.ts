// Palette + mark shapes shared across the messenger-style screens.
export const COLORS: Record<string, string> = {
  green: "#22c55e",
  blue: "#3b82f6",
  red: "#ef4444",
  orange: "#f97316",
  purple: "#8b5cf6",
  cyan: "#06b6d4",
  pink: "#ec4899",
  yellow: "#eab308",
  teal: "#14b8a6",
  coral: "#fb7185",
  brown: "#92400e",
  black: "#111111",
  grey: "#9ca3af",
};

export function colorHex(name: string | undefined, fallback = "#9ca3af"): string {
  if (!name) return fallback;
  return COLORS[name] ?? name; // names stay names; raw hex passes through
}

/** Mark shapes as border-radius sets — the desktop shows the same family
 * (blob, circle, squircle…) so the phone mirrors it without an SVG dep. */
export const SHAPES = ["blob", "circle", "squircle", "diamond", "star", "hex"] as const;
export type ShapeId = (typeof SHAPES)[number];

export function shapeRadius(shape: ShapeId | undefined, size: number) {
  const s = size / 2;
  switch (shape) {
    case "circle":
      return { borderRadius: s };
    case "squircle":
      return { borderRadius: size * 0.32 };
    case "diamond":
      return { borderRadius: size * 0.14, transform: [{ rotate: "45deg" as const }] };
    case "star":
      return {
        borderTopLeftRadius: s,
        borderTopRightRadius: size * 0.18,
        borderBottomRightRadius: s,
        borderBottomLeftRadius: size * 0.18,
      };
    case "hex":
      return { borderRadius: size * 0.22 };
    default: // blob
      return {
        borderTopLeftRadius: s,
        borderTopRightRadius: size * 0.3,
        borderBottomRightRadius: size * 0.32,
        borderBottomLeftRadius: s,
      };
  }
}

export const SWATCHES = [
  "#111111", "#92400e", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#9ca3af",
];
