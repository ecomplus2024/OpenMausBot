# OpenMausBot Phone App

A React Native (Expo) client for OpenMausBot. Pair by scanning the QR code shown
in the desktop app's **Remote access** settings; traffic goes over the hosted
Cloudflare tunnel endpoint (or LAN/Tailscale fallbacks) to the companion sidecar.

## Features

- QR scan → `openmausbot://pair` deep link → `POST /api/pair` → device token in Secure Store
- Manual 6-digit code pairing fallback
- Endpoint walking: hosted (Cloudflare) first, then tailnet/lan/bonjour; live refresh via `/api/companion/endpoints`
- Bots + Rooms tabs, thread view, send messages
- Approval/question cards (inline answer in thread)
- SSE event stream (`/api/events`) with cursor resume + refresh fallback

## Development

```bash
npm install
npx expo start        # dev server (Expo Go won't work — custom native modules; use a dev build)
npm run lint
npx tsc --noEmit
```

Requires Node >= 20 (Node 24 recommended).

## Smoke test (no real device / no real server data)

```bash
node scripts/smoke-companion.mjs
```

Spins up an isolated harness + companion sidecar with a temp HOME and fake
engine, then exercises the app's real client code: QR parse → pair → authenticated
API calls → SSE. Never touches your live OpenMausBot data.

## Building the APK

### Option A — Local (this machine is set up)

JDK 17 (Temurin) and the Android SDK are installed under `D:\Android\sdk`.

```bash
# Git Bash
export JAVA_HOME="C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.20.101-hotspot"
export ANDROID_HOME="D:\\Android\\sdk"
npx expo prebuild --platform android   # regenerates ./android — safe to re-run
cd android && ./gradlew.bat assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed with the Android debug key — installable on any device
that allows unknown sources. For a shareable release build, use EAS below.

### Option B — GitHub Actions

The repo includes `.github/workflows/phone-apk.yml`. Push to a branch touching
`phone-app/**` (or run it manually via **Actions → Phone app APK → Run workflow**)
and download the `openmausbot-debug-apk` artifact.

### Option C — EAS Build

```bash
npm install -g eas-cli   # or: npx eas-cli@latest
eas login
eas build --platform android --profile apk
```

The `apk` profile in `eas.json` produces an installable `.apk` (not an `.aab`).

## Pairing

1. On the desktop app: open Remote access settings → show the pairing QR.
2. In the phone app: **Scan QR** → point at the code. The app picks the hosted
   `https://…` (Cloudflare tunnel) endpoint automatically.
3. Alternatively tap **Enter code** and type the 6-digit pairing code.

The device token is stored in Android Keystore via `expo-secure-store`.
