// Self-update over the GitHub release: the APK on the fork is the update
// channel. The release also carries a tiny version.json asset — installed
// builds compare their baked android.versionCode against it, so a device
// running the newest APK never prompts for its own update.
//
// Android always asks the user to confirm the install once — nothing
// outside Play can skip that confirmation.
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

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

/** Download to cache, then hand off to the system package installer. */
export async function downloadAndInstall(
  update: AvailableUpdate,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const dest = new File(Paths.cache, "openmausbot-update.apk");
  if (dest.exists) dest.delete();
  onProgress?.(0);
  const file = await File.downloadFileAsync(update.url, dest);
  onProgress?.(1);
  // file.contentUri is served through expo-file-system's FileProvider —
  // the installer can read it once we grant the URI permission.
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: file.contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
  });
}
