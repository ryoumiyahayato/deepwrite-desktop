#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(projectRoot, "src-tauri/tauri.conf.json");
const packagePath = resolve(projectRoot, "package.json");
const cargoPath = resolve(projectRoot, "src-tauri/Cargo.toml");
const minimumOfflineInstallerBytes = 100 * 1024 * 1024;

function fail(message) {
  throw new Error(`Windows bundle validation failed: ${message}`);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a path`);
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cargoPackageVersion(cargoToml) {
  const packageSection = cargoToml
    .split(/(?=^\[)/m)
    .find((section) => section.startsWith("[package]"));
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) fail("cannot read [package].version from src-tauri/Cargo.toml");
  return version;
}

const config = readJson(configPath);
const packageJson = readJson(packagePath);
const cargoVersion = cargoPackageVersion(readFileSync(cargoPath, "utf8"));
const windowsBundle = config.bundle?.windows;
const webviewMode = windowsBundle?.webviewInstallMode?.type;
const installMode = windowsBundle?.nsis?.installMode;

if (webviewMode !== "offlineInstaller") {
  fail(`bundle.windows.webviewInstallMode.type must be offlineInstaller, received ${String(webviewMode)}`);
}

if (installMode !== "currentUser") {
  fail(`bundle.windows.nsis.installMode must be currentUser, received ${String(installMode)}`);
}

const versions = [packageJson.version, config.version, cargoVersion];
if (new Set(versions).size !== 1) {
  fail(`version mismatch: package.json=${versions[0]}, tauri.conf.json=${versions[1]}, Cargo.toml=${versions[2]}`);
}

const releaseMode = process.argv.includes("--release");
let artifactPath = argumentValue("--artifact");
let generatedNsiPath = argumentValue("--generated-nsi");
if (releaseMode) {
  if (artifactPath || generatedNsiPath) fail("--release cannot be combined with explicit artifact paths");
  artifactPath = resolve(
    projectRoot,
    `src-tauri/target/release/bundle/nsis/DeepWrite_${versions[0]}_x64-setup.exe`,
  );
  generatedNsiPath = resolve(projectRoot, "src-tauri/target/release/nsis/x64/installer.nsi");
}
let artifactBytes;
let payloadPath;
let payloadBytes;

if (artifactPath || generatedNsiPath) {
  if (!artifactPath || !generatedNsiPath) {
    fail("--artifact and --generated-nsi must be provided together");
  }
  if (!existsSync(artifactPath)) fail(`installer artifact does not exist: ${artifactPath}`);
  artifactBytes = statSync(artifactPath).size;
  if (artifactBytes < minimumOfflineInstallerBytes) {
    fail(`installer is only ${artifactBytes} bytes; expected at least ${minimumOfflineInstallerBytes} bytes with the offline runtime`);
  }

  if (!existsSync(generatedNsiPath)) fail(`generated NSIS script does not exist: ${generatedNsiPath}`);
  const nsi = readFileSync(generatedNsiPath, "utf8");
  if (!/^!define INSTALLWEBVIEW2MODE "offlineInstaller"$/m.test(nsi)) {
    fail("generated NSIS script does not use offlineInstaller");
  }
  const payloadMatch = nsi.match(/^!define WEBVIEW2INSTALLERPATH "([^"]+)"$/m);
  if (!payloadMatch?.[1]) fail("generated NSIS script has no embedded WebView2 installer path");
  payloadPath = payloadMatch[1];
  if (!existsSync(payloadPath)) fail(`WebView2 offline installer payload does not exist: ${payloadPath}`);
  payloadBytes = statSync(payloadPath).size;
  if (payloadBytes < minimumOfflineInstallerBytes) {
    fail(`WebView2 payload is only ${payloadBytes} bytes; expected an Evergreen Offline Installer`);
  }
}

const report = [
  "Windows bundle validation passed",
  `version=${versions[0]}`,
  `webviewInstallMode=${webviewMode}`,
  `nsis.installMode=${installMode}`,
];
if (artifactPath) {
  report.push(
    `artifact=${artifactPath}`,
    `artifactBytes=${artifactBytes}`,
    `webview2Payload=${payloadPath}`,
    `webview2PayloadBytes=${payloadBytes}`,
  );
}
process.stdout.write(`${report.join("\n")}\n`);
