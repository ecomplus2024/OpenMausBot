// Self-update over the GitHub release: the APK on the fork is the update
// channel. The release also carries a tiny version.json asset — installed
// builds compare their baked android.versionCode against it, so a device
// running the newest APK never prompts for its own update.
//
// The download itself is handed to the system browser: it downloads the
// APK, then Android's installer takes over with its usual one confirm.
import Constants from "expo-constants";
import { Linking, Platform } from "react-native";

const RELEASE_API =
  "https://api.github.com/repos/ecomplus2024/OpenMausBot/releases/tags/v1.0.0-phone";
const ASSET_NAME = "openmausbot-arm64.apk";
const VERSION_ASSET = "version.json";

export interface AvailableUpdate {
  url: string;
  versionCode: number;
  size: number;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** Null when the release is not newer than this build. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (Platform.OS !== "android") return null;
  try {
    const res = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const release = (await res.json()) as { assets?: ReleaseAsset[] };
    const apk = release.assets?.find((a) => a.name === ASSET_NAME);
    const meta = release.assets?.find((a) => a.name === VERSION_ASSET);
    if (!apk || !meta) return null;

    const metaRes = await fetch(meta.browser_download_url);
    if (!metaRes.ok) return null;
    const { versionCode } = (await metaRes.json()) as { versionCode?: number };
    const mine = Constants.expoConfig?.android?.versionCode ?? 0;
    if (!versionCode || versionCode <= mine) return null;

    return { url: apk.browser_download_url, versionCode, size: apk.size };
  } catch {
    return null; // offline / rate-limited — updates are best-effort
  }
}

/** Hand the APK link to the system browser — it downloads and Android's
 * installer offers the update on top of the existing app. */
export async function openUpdate(update: AvailableUpdate): Promise<void> {
  await Linking.openURL(update.url);
}
