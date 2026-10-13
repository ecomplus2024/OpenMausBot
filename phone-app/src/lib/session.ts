// The bearer token is the whole trust of this device — it lives in
// expo-secure-store (Keystore/Keychain), never in AsyncStorage or the bundle.
import * as SecureStore from "expo-secure-store";
import { SHAPES, type ShapeId } from "./theme";
import type { Session } from "./types";

const KEY = "openmausbot.session";
const MARKS_KEY = "openmausbot.marks";

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.token || !Array.isArray(session.endpoints) || !session.endpoints.length) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** Per-device bot mark overrides (color/shape) — cosmetic, phone-local. */
export async function loadMarks(): Promise<Record<string, { color?: string; shape?: ShapeId }>> {
  try {
    const raw = await SecureStore.getItemAsync(MARKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, { color?: string; shape?: string }>) : {};
    const marks: Record<string, { color?: string; shape?: ShapeId }> = {};
    for (const [id, mark] of Object.entries(parsed)) {
      marks[id] = {
        color: mark.color,
        shape: (SHAPES as readonly string[]).includes(mark.shape ?? "") ? (mark.shape as ShapeId) : undefined,
      };
    }
    return marks;
  } catch {
    return {};
  }
}

export async function saveMarks(marks: Record<string, { color?: string; shape?: string }>): Promise<void> {
  await SecureStore.setItemAsync(MARKS_KEY, JSON.stringify(marks));
}

export function randomId(): string {
  // sendId/pairRequestId only need uniqueness within this device.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
