import { existsSync, lstatSync, readFileSync, realpathSync, statSync, watch } from "node:fs";
import { resolve, sep } from "node:path";
import process from "node:process";

const [command = "help", directory = "."] = process.argv.slice(2);
const root = resolve(directory);

if (command === "validate") {
  validate(root);
} else if (command === "dev") {
  validate(root);
  console.log(`Mode développement actif pour ${root}`);
  console.log("Les changements sont validés automatiquement. Rechargez le mod depuis Twelia.");
  let timer;
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename || !/\.(?:json|js|mjs|ts)$/.test(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        validate(root);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    }, 150);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      watcher.close();
      process.exit(0);
    });
  }
} else {
  console.log("Usage : pnpm mod validate <dossier> | pnpm mod dev <dossier>");
  if (command !== "help") process.exitCode = 1;
}

function validate(packageRoot) {
  const manifestPath = resolve(packageRoot, "manifest.json");
  if (!existsSync(manifestPath)) fail(`Manifeste introuvable : ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest.json invalide : ${error instanceof Error ? error.message : String(error)}`);
  }
  const allowedFields = new Set([
    "schemaVersion",
    "id",
    "name",
    "version",
    "apiVersion",
    "entry",
    "gameEntry",
    "network",
    "capabilities",
    "settings",
    "description",
    "author",
    "homepage",
    "license",
    "repository",
    "minTweliaVersion",
  ]);
  const unknown = Object.keys(manifest).filter((key) => !allowedFields.has(key));
  if (unknown.length) fail(`Champs inconnus dans le manifeste : ${unknown.join(", ")}`);
  if (manifest.schemaVersion !== 1 || manifest.apiVersion !== 1) {
    fail("schemaVersion et apiVersion doivent valoir 1");
  }
  if (
    typeof manifest.id !== "string" ||
    manifest.id.length > 128 ||
    manifest.id.includes("..") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(manifest.id)
  ) {
    fail("Identifiant de mod invalide");
  }
  validateRequiredText(manifest.name, 80, "nom de mod");
  if (!isSemver(manifest.version)) {
    fail("Version SemVer invalide");
  }
  validateEntry(packageRoot, manifest.entry, "entry");
  if (manifest.gameEntry !== undefined) validateEntry(packageRoot, manifest.gameEntry, "gameEntry");
  if (manifest.entry === manifest.gameEntry) fail("entry et gameEntry doivent être distincts");
  const capabilities = manifest.capabilities;
  const knownCapabilities = new Set([
    "network",
    "notifications",
    "clipboard.write",
    "files.user-selected",
    "secrets",
    "game-entry",
  ]);
  if (!Array.isArray(capabilities) || capabilities.some((item) => !knownCapabilities.has(item))) {
    fail("Liste de capacités invalide");
  }
  if (new Set(capabilities).size !== capabilities.length) fail("Capacité dupliquée");
  const network = manifest.network === undefined ? [] : manifest.network;
  if (!Array.isArray(network)) fail("network doit être un tableau");
  if (network.length > 32) fail("Trop d’origines réseau déclarées");
  const networkOrigins = new Set();
  for (const origin of network) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      fail(`Origine réseau invalide : ${origin}`);
    }
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      fail(`Origine réseau non sûre : ${origin}`);
    }
    if (networkOrigins.has(url.origin)) fail(`Origine réseau dupliquée : ${url.origin}`);
    networkOrigins.add(url.origin);
  }
  if (network.length && !capabilities.includes("network")) {
    fail("La capacité network est requise par le manifeste");
  }
  if (!network.length && capabilities.includes("network")) {
    fail("La capacité network nécessite au moins une origine HTTPS");
  }
  if (manifest.gameEntry && !capabilities.includes("game-entry")) {
    fail("La capacité game-entry est requise par le manifeste");
  }
  if (!manifest.gameEntry && capabilities.includes("game-entry")) {
    fail("La capacité game-entry nécessite un gameEntry");
  }
  validateSettings(manifest.settings === undefined ? {} : manifest.settings, capabilities);
  validateOptionalText(manifest.description, 500, "description");
  validateOptionalText(manifest.author, 120, "auteur");
  validateOptionalText(manifest.license, 80, "licence");
  validateHttpsUrl(manifest.homepage, "homepage");
  validateHttpsUrl(manifest.repository, "repository");
  if (
    manifest.minTweliaVersion !== undefined &&
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.minTweliaVersion)
  ) {
    fail("minTweliaVersion doit être une version SemVer stable");
  }
  console.log(`✓ ${manifest.id} v${manifest.version} est valide`);
  return manifest;
}

function validateEntry(packageRoot, entry, label) {
  if (
    typeof entry !== "string" ||
    !entry.endsWith(".js") ||
    entry.includes("\\") ||
    entry.startsWith("/") ||
    entry.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail(`${label} doit désigner un fichier JavaScript relatif`);
  }
  const path = resolve(packageRoot, entry);
  if (
    !path.startsWith(`${packageRoot}${sep}`) ||
    !existsSync(path) ||
    lstatSync(path).isSymbolicLink() ||
    !statSync(path).isFile()
  ) {
    fail(`${label} sort du paquet ou n’existe pas : ${entry}`);
  }
  const canonicalRoot = realpathSync(packageRoot);
  const canonicalPath = realpathSync(path);
  if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`)) fail(`${label} sort du paquet`);
  if (statSync(path).size > 2 * 1024 * 1024) fail(`${label} dépasse 2 Mio`);
}

function validateSettings(settings, capabilities) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    fail("settings doit être un objet");
  }
  if (Object.keys(settings).length > 64) fail("Trop de réglages déclarés");
  for (const [key, definition] of Object.entries(settings)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) fail(`Identifiant de réglage invalide : ${key}`);
    if (!definition || typeof definition !== "object") fail(`Réglage invalide : ${key}`);
    const allowedFields = new Set([
      "type",
      "label",
      "description",
      "default",
      "placeholder",
      "minimum",
      "maximum",
      "step",
      "options",
    ]);
    const unknown = Object.keys(definition).filter((field) => !allowedFields.has(field));
    if (unknown.length) fail(`Champs inconnus pour le réglage ${key} : ${unknown.join(", ")}`);
    if (!["boolean", "string", "number", "select", "secret"].includes(definition.type)) {
      fail(`Type de réglage inconnu : ${key}`);
    }
    validateRequiredText(definition.label, 120, `libellé du réglage ${key}`);
    validateOptionalText(definition.description, 500, `description du réglage ${key}`);
    validateOptionalText(definition.placeholder, 200, `placeholder du réglage ${key}`);
    if (
      definition.type === "select" &&
      (!Array.isArray(definition.options) ||
        !definition.options.length ||
        definition.options.length > 100)
    ) {
      fail(`Options manquantes pour le réglage ${key}`);
    }
    if (definition.type === "select") {
      const optionValues = new Set();
      for (const option of definition.options) {
        if (
          !option ||
          typeof option !== "object" ||
          Object.keys(option).some((field) => !["value", "label"].includes(field))
        ) {
          fail(`Option invalide pour le réglage ${key}`);
        }
        validateRequiredText(option.value, 128, `valeur d’option du réglage ${key}`);
        validateRequiredText(option.label, 128, `libellé d’option du réglage ${key}`);
        if (optionValues.has(option.value)) fail(`Option dupliquée pour le réglage ${key}`);
        optionValues.add(option.value);
      }
    } else if (
      definition.options !== undefined &&
      (!Array.isArray(definition.options) || definition.options.length !== 0)
    ) {
      fail(`Le réglage ${key} ne peut pas déclarer d’options`);
    }
    if (definition.type === "number") {
      for (const field of ["minimum", "maximum", "step"]) {
        if (definition[field] !== undefined && !Number.isFinite(definition[field])) {
          fail(`${field} invalide pour le réglage ${key}`);
        }
      }
      if (
        (definition.minimum !== undefined &&
          definition.maximum !== undefined &&
          definition.minimum > definition.maximum) ||
        (definition.step !== undefined && definition.step <= 0)
      ) {
        fail(`Bornes numériques invalides pour le réglage ${key}`);
      }
    } else if (
      definition.minimum !== undefined ||
      definition.maximum !== undefined ||
      definition.step !== undefined
    ) {
      fail(`Le réglage ${key} ne peut pas déclarer de bornes numériques`);
    }
    if (definition.type === "secret" && "default" in definition) {
      fail(`Un secret ne peut pas avoir de valeur par défaut : ${key}`);
    }
    if (definition.type === "secret" && !capabilities.includes("secrets")) {
      fail(`Le réglage secret ${key} nécessite la capacité secrets`);
    }
    if ("default" in definition) validateSettingValue(key, definition, definition.default);
  }
}

function validateSettingValue(key, definition, value) {
  if (definition.type === "boolean" && typeof value !== "boolean") {
    fail(`La valeur par défaut de ${key} doit être un booléen`);
  }
  if (
    definition.type === "string" &&
    (typeof value !== "string" || value.length > 4096 || hasInvalidControl(value, true))
  ) {
    fail(`La valeur par défaut de ${key} doit être une chaîne valide`);
  }
  if (
    definition.type === "number" &&
    (!Number.isFinite(value) ||
      (definition.minimum !== undefined && value < definition.minimum) ||
      (definition.maximum !== undefined && value > definition.maximum))
  ) {
    fail(`La valeur par défaut de ${key} est hors limites`);
  }
  if (
    definition.type === "select" &&
    (typeof value !== "string" || !definition.options.some((option) => option.value === value))
  ) {
    fail(`La valeur par défaut de ${key} ne correspond à aucune option`);
  }
}

function validateRequiredText(value, maximum, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value].length > maximum ||
    hasInvalidControl(value)
  ) {
    fail(`${label} invalide`);
  }
}

function validateOptionalText(value, maximum, label) {
  if (value !== undefined) validateRequiredText(value, maximum, label);
}

function validateHttpsUrl(value, label) {
  if (value === undefined) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname) fail(`${label} doit utiliser HTTPS`);
  } catch {
    fail(`${label} invalide`);
  }
}

function hasInvalidControl(value, multiline = false) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 && !(multiline && [9, 10, 13].includes(code));
  });
}

function isSemver(value) {
  if (typeof value !== "string") return false;
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      value,
    );
  if (!match) return false;
  const prerelease = match[4]?.split(".") ?? [];
  const build = match[5]?.split(".") ?? [];
  return (
    prerelease.every(
      (part) => part && (!/^\d+$/.test(part) || part === "0" || !part.startsWith("0")),
    ) && build.every(Boolean)
  );
}

function fail(message) {
  throw new Error(message);
}
