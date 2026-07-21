import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const env = { ...process.env };

if (args[0] === "android") configureAndroidLibclang(env);

const tauri = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const result = spawnSync(process.execPath, [tauri, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

function configureAndroidLibclang(targetEnv) {
  const ndk = findAndroidNdk(targetEnv);
  if (!ndk) {
    throw new Error(
      "Android NDK introuvable. Définissez ANDROID_NDK_HOME ou installez le NDK depuis Android Studio.",
    );
  }

  const host =
    process.platform === "win32"
      ? "windows-x86_64"
      : process.platform === "darwin"
        ? "darwin-x86_64"
        : "linux-x86_64";
  const toolchain = join(ndk, "toolchains", "llvm", "prebuilt", host);
  const libraryNames =
    process.platform === "win32"
      ? ["libclang.dll"]
      : process.platform === "darwin"
        ? ["libclang.dylib"]
        : ["libclang.so"];
  const candidates = [join(toolchain, "bin"), join(toolchain, "lib"), join(toolchain, "lib64")];
  const libclang = candidates.find((directory) =>
    libraryNames.some((name) => existsSync(join(directory, name))),
  );
  if (!libclang) {
    throw new Error(`libclang introuvable dans le NDK ${ndk}.`);
  }

  targetEnv.LIBCLANG_PATH ??= libclang;
  const pathKey = Object.keys(targetEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
  targetEnv[pathKey] = `${join(toolchain, "bin")}${delimiter}${targetEnv[pathKey] ?? ""}`;
}

function findAndroidNdk(targetEnv) {
  for (const candidate of [targetEnv.ANDROID_NDK_HOME, targetEnv.ANDROID_NDK_ROOT]) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  const sdkCandidates = [
    targetEnv.ANDROID_HOME,
    targetEnv.ANDROID_SDK_ROOT,
    targetEnv.LOCALAPPDATA && join(targetEnv.LOCALAPPDATA, "Android", "Sdk"),
    targetEnv.HOME && join(targetEnv.HOME, "Android", "Sdk"),
    targetEnv.HOME && join(targetEnv.HOME, "Library", "Android", "sdk"),
  ].filter(Boolean);

  for (const sdk of sdkCandidates) {
    const ndkRoot = join(sdk, "ndk");
    if (!existsSync(ndkRoot)) continue;
    const versions = readdirSync(ndkRoot)
      .map((name) => join(ndkRoot, name))
      .filter((path) => statSync(path).isDirectory())
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    if (versions.length) return versions[0];
  }
}
