import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

// The published image: the self-hosted server (the default target). A pull
// downloads every layer whose digest changed, and a layer's digest changes
// when anything beneath it does.
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const workflow = parse(readFileSync(new URL("../.github/workflows/docker.yml", import.meta.url), "utf8"));

interface Step { op: string; args: string }
interface Stage { name: string; from: string; steps: Step[] }

function stages(text: string): Stage[] {
  const all: Stage[] = [];
  let pending = "";
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line) || (!pending && !line.trim())) continue;
    pending += line.endsWith("\\") ? `${line.slice(0, -1)} ` : line;
    if (line.endsWith("\\")) continue;
    const [, op, args] = /^\s*(\S+)\s*([\s\S]*)$/.exec(pending)!;
    pending = "";
    if (op.toUpperCase() === "FROM") {
      const [, from, name] = /^(\S+)(?:\s+AS\s+(\S+))?$/i.exec(args.trim())!;
      all.push({ name: name ?? `#${all.length}`, from, steps: [] });
    } else all.at(-1)?.steps.push({ op: op.toUpperCase(), args: args.trim() });
  }
  return all;
}

const all = stages(dockerfile);
/** Every instruction a target's image is built from, its parents' first. */
function chain(target: string): Step[] {
  const stage = all.find(s => s.name === target);
  if (!stage) throw new Error(`the Dockerfile has no ${target} stage`);
  return [...(all.some(s => s.name === stage.from) ? chain(stage.from) : []), ...stage.steps];
}
const shipped = () => all.filter(s => s.name !== "build").flatMap(s => s.steps);
const npmInstall = (step: Step) => step.op === "RUN" && /\bnpm install\b/.test(step.args);
const browserRun = () => chain("runtime").find(step => step.op === "RUN" && step.args.includes("agent-browser install"))!;
// The keys step parses Chrome for Testing's JSON with jq, as on GitHub's runners.
const jq = process.platform === "win32" ? "" : spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf8" }).stdout.trim();

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("container images", () => {
  it("keeps the self-hosted server the default target", () => {
    expect(all.at(-1)!.name).toBe("server");
    expect(all.find(s => s.name === "server")!.from).toBe("runtime");
    // the build arg docker-compose.yml passes keeps its name and empty default
    expect(chain("server")).toContainEqual({ op: "ARG", args: 'ENGINES=""' });
  });

  it("puts the browser and the engines beneath the per-commit app files, so a code change leaves them as they were", () => {
    for (const target of ["server"]) {
      const steps = chain(target);
      const heavy = steps.flatMap((step, i) => (npmInstall(step) ? [i] : []));
      const app = steps.flatMap((step, i) => (step.op === "COPY" ? [i] : []));
      // agent-browser + Chrome, then the engines, then the app files
      expect(heavy, target).toHaveLength(2);
      const fromBuild = steps.flatMap((step, i) => (step.op === "COPY" && step.args.includes("--from=build") ? [i] : []));
      expect(fromBuild, target).toHaveLength(3);
      expect(Math.max(...heavy), target).toBeLessThan(Math.min(...app));
      // The Data engine's native tree (DuckDB, resvg) changes on a version bump,
      // not per commit, so it is copied before the per-commit app files.
      const native = steps.findIndex(step => step.op === "COPY" && step.args.includes("/dist-native/duckdb/"));
      expect(native, target).toBeGreaterThan(-1);
      expect(native, target).toBeLessThan(Math.min(...fromBuild.filter(i => i !== native)));
    }
  });

  it("leaves no npm or compile cache in a layer: each install removes its own in the same step", () => {
    const installs = shipped().filter(npmInstall);
    expect(installs.length).toBeGreaterThanOrEqual(2);
    for (const { args } of installs) {
      const cache = /--cache (\S+)/.exec(args)?.[1] ?? /\bHOME=(\S+) npm install\b/.exec(args)?.[1];
      expect(cache, args).toMatch(/^\/tmp\//);
      const removed = /\brm -rf ([^;&|]+)/.exec(args)?.[1].split(/\s+/) ?? [];
      expect(removed, args).toEqual(expect.arrayContaining([cache, "/tmp/node-compile-cache"]));
    }
  });

  it("ships the app files once, modes fixed in the build stage without a rewrite in a shipped layer", () => {
    for (const { args } of shipped()) expect(args).not.toMatch(/\bch(own|mod) -R\b/);
    // modes are fixed where the files are built, in a stage that is not shipped
    const build = all.find(s => s.name === "build")!.steps.find(step => step.op === "RUN" && step.args.startsWith("pnpm build:server"))!;
    expect(build.args).toMatch(/ && chmod -R go-w dist dist-server$/);
    expect(chain("server").filter(step => step.args.includes("--from=build")).every(step => step.args.startsWith("--from=build --chown=maus:maus "))).toBe(true);
  });

  it("scans the saved image for every throwaway build directory", () => {
    const scan = (workflow.jobs["build-and-smoke"].steps as { name?: string; run?: string }[])
      .find(step => step.name?.startsWith("Prove the image ships its files once"))!.run!;
    const cache = new RegExp(/cache = re\.compile\(r"(.*)"\)/.exec(scan)![1]);
    const removed = shipped().flatMap(step => [...step.args.matchAll(/\brm -rf ([^;&|]+)/g)].flatMap(match => match[1].trim().split(/\s+/)));
    const throwaway = [...new Set(removed.filter(path => path.startsWith("/tmp/")))].sort();
    expect(throwaway).toEqual(["/tmp/node-compile-cache", "/tmp/npm-cache", "/tmp/omb-build-home"]);
    for (const path of throwaway) expect(cache.test(`${path.slice(1)}/leftover`), path).toBe(true);
  });

  it("keeps the image's runtime contract", () => {
    const last = (steps: Step[], op: string) => steps.filter(step => step.op === op).at(-1)?.args;
    const server = chain("server");
    expect(last(server, "USER")).toBe("maus");
    expect(last(server, "VOLUME")).toBe('["/data"]');
    expect(last(server, "CMD")).toBe('["node", "dist-server/server-launcher.js"]');
    expect(last(server, "HEALTHCHECK")).toContain("http://127.0.0.1:8799/api/health");
    expect(last(chain("runtime"), "ENV")).toMatch(/^AGENT_BROWSER_EXECUTABLE_PATH=\/opt\/openmausbot-browser\/chrome .*NODE_ENV=production$/);
  });

  it("never runs a build step with HOME on the volume, so nothing lands in what a fresh volume starts with", () => {
    for (const target of ["server"]) {
      const steps = chain(target);
      const home = steps.findIndex(step => step.op === "ENV" && /(^|\s)HOME=\/data\b/.test(step.args));
      expect(home, target).toBeGreaterThan(-1);
      expect(steps.slice(home).filter(step => step.op === "RUN"), target).toEqual([]);
    }
  });

  it.skipIf(process.platform === "win32")("keeps only agent-browser's native binary, and refuses when the command is not one", () => {
    const { args } = browserRun();
    const start = args.indexOf("native=");
    const end = args.indexOf("&& agent-browser --version", start);
    expect(start).toBeGreaterThan(args.indexOf("agent-browser install"));
    expect(end).toBeGreaterThan(start);
    const prune = args.slice(start, end);
    const run = (target: string, elf = true) => {
      const root = mkdtempSync(join(tmpdir(), "omb-agent-browser-"));
      temporaryDirectories.push(root);
      const bin = join(root, "lib/node_modules/agent-browser/bin");
      mkdirSync(bin, { recursive: true });
      mkdirSync(join(root, "bin"));
      const names = ["agent-browser-darwin-arm64", "agent-browser-linux-arm64", "agent-browser-linux-musl-x64", "agent-browser-linux-x64", "agent-browser-win32-x64.exe", "agent-browser.js"];
      for (const name of names) writeFileSync(join(bin, name), name === "agent-browser-linux-x64" && elf ? "\x7fELF\x02\x01" : "#!/usr/bin/env node\n", { mode: 0o755 });
      symlinkSync(join(bin, target), join(root, "bin/agent-browser"));
      const result = spawnSync("sh", ["-c", prune], { env: { PATH: `${join(root, "bin")}:/usr/bin:/bin` }, encoding: "utf8" });
      return { status: result.status, left: readdirSync(bin).sort(), names };
    };
    expect(run("agent-browser-linux-x64")).toMatchObject({ status: 0, left: ["agent-browser-linux-x64", "agent-browser.js"] });
    // npm linking the JS wrapper instead must stop the build, not delete every native binary
    const wrapper = run("agent-browser.js");
    expect(wrapper.status).not.toBe(0);
    expect(wrapper.left).toEqual(wrapper.names);
    const script = run("agent-browser-linux-x64", false);
    expect(script.status).not.toBe(0);
    expect(script.left).toEqual(script.names);
  });

  it("keys the browser layer on the version it installs, so a Chrome release rebuilds it", () => {
    const runtime = all.find(s => s.name === "runtime")!.steps;
    const declared = runtime.findIndex(step => step.op === "ARG" && step.args.startsWith("CHROME_CACHE_TAG="));
    // declared after the apt step, so a Chrome release rebuilds only the browser layer
    expect(declared).toBeGreaterThan(runtime.findIndex(step => step.op === "RUN" && step.args.startsWith("apt-get update")));
    expect(declared).toBeLessThan(runtime.indexOf(browserRun()));
    expect(browserRun().args).toContain("${CHROME_CACHE_TAG");
    const server = (workflow.jobs.publish.steps as { uses?: string; with?: Record<string, string> }[])
      .find(step => step.uses?.startsWith("docker/build-push-action@"))!;
    expect(server.with!["build-args"]).toContain("CHROME_CACHE_TAG=${{ steps.keys.outputs.chrome }}");
  });

  it.skipIf(!jq)("resolves the current Chrome release, and keys on the date when the lookup fails", () => {
    const keys = (workflow.jobs.publish.steps as { id?: string; run?: string; env?: Record<string, string> }[]).find(step => step.id === "keys")!;
    const resolve = (ok: boolean) => {
      const root = mkdtempSync(join(tmpdir(), "omb-docker-keys-"));
      temporaryDirectories.push(root);
      writeFileSync(join(root, "curl"), `#!/bin/sh\n${ok ? `echo '{"channels":{"Stable":{"version":"154.0.8037.92","downloads":{}}}}'` : "exit 1"}\n`, { mode: 0o755 });
      const output = join(root, "output");
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-e", "-c", keys.run!], {
        env: { ...keys.env, PATH: `${root}:${dirname(jq)}:/usr/bin:/bin`, GITHUB_OUTPUT: output }, encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      return Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    };
    expect(resolve(true)).toEqual({ chrome: "154.0.8037.92" });
    expect(resolve(false)).toEqual({ chrome: `date-${new Date().toISOString().slice(0, 10)}` });
  });
});
