#!/usr/bin/env node
// Stamp a unique build identity before a release build:
//   node scripts/bump-build.mjs
//
// - android.versionCode in app.json becomes the epoch-second timestamp, so
//   every build is strictly newer than the last (and Android accepts it).
// - version.json next to it mirrors that number — upload it as a release
//   asset beside the APK. Installed apps compare their baked versionCode
//   against it, which is why "the APK I'm running" never self-prompts.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const vc = Math.floor(Date.now() / 1000);

const appJsonPath = join(dir, "app.json");
const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
appJson.expo.android.versionCode = vc;
writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + "\n");

writeFileSync(join(dir, "version.json"), JSON.stringify({ versionCode: vc }) + "\n");
console.log(`versionCode → ${vc}`);
