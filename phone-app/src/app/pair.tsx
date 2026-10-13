import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, redeemPairing } from "../lib/client";
import { parsePairingLink } from "../lib/pairing";
import { randomId, saveSession } from "../lib/session";
import { useFleet } from "../lib/store";
import type { PairingInvite } from "../lib/types";

/** POST /api/pair against each advertised route until one answers. */
async function pairAcrossEndpoints(invite: PairingInvite, deviceName: string) {
  const requestId = randomId();
  let refusal: Error | null = null;
  for (const endpoint of invite.endpoints) {
    try {
      const res = await redeemPairing(endpoint, invite, deviceName, requestId);
      if (!res) continue;
      return {
        token: res.token,
        deviceId: res.device.id,
        deviceName: res.device.name,
        serverName: res.serverName,
        endpoints: res.endpoints?.length ? res.endpoints : invite.endpoints,
      };
    } catch (error) {
      // A refused credential is fatal for every route — same registry behind all.
      refusal = error instanceof Error ? error : new Error(String(error));
      if (error instanceof ApiError) throw refusal;
    }
  }
  throw refusal ?? new Error("Could not reach the computer on any route");
}

export default function PairScreen() {
  const { connect } = useFleet();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [manualAddress, setManualAddress] = useState("");
  const [manualCode, setManualCode] = useState("");
  const handled = useRef(false);

  const finish = useCallback(
    async (invite: PairingInvite) => {
      setBusy(true);
      setError(null);
      try {
        const session = await pairAcrossEndpoints(invite, "Android");
        await saveSession(session);
        // Re-run the boot sequence so the store builds a Client from the
        // session we just saved — refresh() alone is a no-op without one.
        await connect();
        router.replace("/(tabs)");
      } catch (cause) {
        handled.current = false;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [connect],
  );

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (handled.current || busy) return;
      const invite = parsePairingLink(data);
      if (!invite) {
        handled.current = true;
        setError("That QR is not an OpenMausBot pairing code — use the one in Settings → Remote access");
        setTimeout(() => (handled.current = false), 2500);
        return;
      }
      handled.current = true;
      void finish(invite);
    },
    [busy, finish],
  );

  const submitManual = useCallback(() => {
    const address = manualAddress.trim();
    const code = manualCode.trim();
    if (!address || !/^\d{6}$/.test(code)) {
      setError("Enter the computer address and the six-digit code");
      return;
    }
    const base = /^https?:\/\//i.test(address) ? address : `http://${address}`;
    void finish({
      address: base,
      // Empty token → redeemPairing sends only `code`. A fake credential
      // here would win over the code server-side and always be wrong.
      token: "",
      code,
      endpoints: [{ url: base.replace(/\/$/, ""), kind: "lan", priority: 200 }],
    });
  }, [manualAddress, manualCode, finish]);

  if (manual) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.form}>
          <Text style={styles.title}>Pair manually</Text>
          <Text style={styles.hint}>
            On the computer: Settings → Remote access → Other ways to connect.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Computer address (host:port or https://…)"
            autoCapitalize="none"
            autoCorrect={false}
            value={manualAddress}
            onChangeText={setManualAddress}
          />
          <TextInput
            style={styles.input}
            placeholder="Six-digit code"
            keyboardType="number-pad"
            maxLength={6}
            value={manualCode}
            onChangeText={setManualCode}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={submitManual} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pair</Text>}
          </Pressable>
          <Pressable onPress={() => setManual(false)} style={styles.link}>
            <Text style={styles.linkText}>Scan a QR instead</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.hint}>Camera access is needed to scan the pairing QR.</Text>
          <Pressable style={styles.button} onPress={() => void requestPermission()}>
            <Text style={styles.buttonText}>Allow camera</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.title}>Connect a computer</Text>
        <Text style={styles.hint}>
          Scan the QR shown by OpenMausBot → Settings → Remote access
        </Text>
        {busy ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={() => setManual(true)} style={styles.link}>
          <Text style={styles.linkText}>Other ways to connect</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 24,
    paddingBottom: 48,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    gap: 8,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "700" },
  hint: { color: "#ddd", textAlign: "center", fontSize: 14 },
  spinner: { marginTop: 8 },
  error: { color: "#ff9b9b", textAlign: "center", marginTop: 8 },
  link: { marginTop: 12, padding: 8 },
  linkText: { color: "#8ecbff", fontSize: 15 },
  form: { flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#0b6bcb",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
