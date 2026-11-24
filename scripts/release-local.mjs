#!/usr/bin/env node
// Release script: the whole release pipeline as one local script. Each machine
// builds what its OS allows (Windows -> MSI, Linux -> deb/AppImage; Android
// comes in phase 11); the draft release collects whatever was produced.
//
//   node scripts/release-local.mjs [X.Y.Z] [--label TEXT] [--push] [--skip-checks]
//
// Without a version it uses today's date, YYYY.MMDD.N, where N is the next free
// release number of the day (2026.1225.0, 2026.1225.1, ...; see
// scripts/lib/version.mjs). Pass X.Y.Z only to override that.
//
// Without --push nothing leaves the machine: it bumps, checks, builds
// locally and prints the remaining commands. With --push it also pushes
// main + the tag and creates/updates the draft GitHub release.
//
// Checks are the same set the CI runs, minus the jobs that need other
// operating systems: the frontend lint + build, cargo fmt/clippy and the
// full Rust test suite in the Docker test container (pnpm test:rust).
//
// Requirements per machine: Node 22, pnpm, Rust 1.90, Docker (for the Rust
// test gate), `gh` authed with repo scope.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	VERSION_RE,
	assertBuildable,
	checkLabel,
	cmpVersions as cmp,
	dateVersionPrefix,
	listTakenVersions,
	nextDateVersion,
	platformVersionProblems,
} from "./lib/version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const TAURI_CONFIG = "app/tauri.conf.json";

function usage() {
	console.log(`Usage: node scripts/release-local.mjs [X.Y.Z] [--label TEXT] [--push] [--skip-checks]

  (no version)   today's date: YYYY.MMDD.N, N = next free release number of the day
  X.Y.Z          exact version override, must be higher than the current one
  --label TEXT   note kept in the commit, tag and draft release title
  --push         also push main + the tag and create/update the draft release
  --skip-checks  skip lint/tests/clippy (for iterating on build issues)
  --help         show this help`);
}

function die(msg) {
	console.error(`\nError: ${msg}`);
	process.exit(1);
}

function sh(cmd, args) {
	console.log(`$ ${cmd} ${args.join(" ")}`);
	execFileSync(cmd, args, {
		cwd: ROOT,
		stdio: "inherit",
	});
}

function out(cmd, args) {
	return execFileSync(cmd, args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function have(cmd) {
	try {
		out(process.platform === "win32" ? "where" : "which", [cmd]);
		return true;
	} catch {
		return false;
	}
}

/** All files under dir ending with one of exts (recursive). */
function findFiles(dir, exts) {
	const found = [];
	if (!existsSync(dir)) return found;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) found.push(...findFiles(p, exts));
		else if (exts.some((e) => name.endsWith(e))) found.push(p);
	}
	return found;
}

// ---- args ---------------------------------------------------------------

const raw = process.argv.slice(2);
if (raw.includes("--help") || raw.includes("-h")) {
	usage();
	process.exit(0);
}
const push = raw.includes("--push");
const skipChecks = raw.includes("--skip-checks");
let label = null;
const labelIdx = raw.indexOf("--label");
if (labelIdx !== -1) label = raw[labelIdx + 1] ?? "";
const labelEq = raw.find((a) => a.startsWith("--label="));
if (labelEq) label = labelEq.slice("--label=".length);
if (label !== null) {
	const labelProblem = checkLabel(label);
	if (labelProblem) die(labelProblem);
	label = label.trim();
}
const labelSuffix = label ? ` (${label})` : "";
const positional = raw.filter((a, i) => !a.startsWith("--") && !(labelIdx !== -1 && i === labelIdx + 1));
if (positional.length > 1) {
	usage();
	die("give at most one version like 1.2.3, or none to use today's date");
}
if (["patch", "minor", "major"].includes(positional[0])) {
	die(
		`"${positional[0]}" is not supported: versions come from the date (YYYY.MMDD.N). Leave the version out, and use --label ${positional[0]} to mark the release.`,
	);
}
// Filled in below once the current version is known (date versions need it).
let version = positional[0] ?? "";
if (version && !VERSION_RE.test(version)) die(`"${version}" is not a version like 1.2.3 (or leave it out to use today's date)`);
let tag = "";

// ---- preflight (read-only) ----------------------------------------------

// The Rust test gate (pnpm test:rust) runs in the Docker test container on
// every platform, so Docker is required even on Windows (Docker Desktop).
for (const tool of ["node", "pnpm", "cargo", "docker", "gh"]) {
	if (!have(tool)) die(`required tool not on PATH: ${tool}`);
}
try {
	out("gh", ["auth", "status"]);
} catch {
	die("gh is not authenticated (run `gh auth login`)");
}
const current = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
if (!version) {
	const { versions, remoteOk } = listTakenVersions((...a) => out("git", a).trim(), dateVersionPrefix());
	if (!remoteOk) console.warn("Warning: could not list tags on origin, picked the release number N from local tags only.");
	try {
		version = nextDateVersion({ taken: versions, current });
	} catch (e) {
		die(e.message);
	}
}
try {
	assertBuildable(version);
} catch (e) {
	die(e.message);
}
tag = `v${version}`;
if (cmp(version, current) <= 0) die(`${version} is not higher than the current version ${current}`);
const branch = out("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") die(`on branch "${branch}"; releases ship from main`);
if (out("git", ["status", "--porcelain"])) die("working tree is not clean (commit or stash first)");
const checkManifest = (file, want) => {
	const text = readFileSync(join(ROOT, file), "utf8");
	if (!text.includes(want)) die(`${file} does not contain ${want}: versions out of sync, fix first`);
};
for (const [f, want] of [
	["package.json", `"version": "${current}"`],
	["app/ui/package.json", `"version": "${current}"`],
	["app/tauri.conf.json", `"version": "${current}"`],
	["Cargo.toml", `version = "${current}"`],
	["Cargo.lock", `version = "${current}"`],
]) checkManifest(f, want);
if (out("git", ["tag", "-l", tag])) die(`tag ${tag} already exists locally`);
try {
	if (out("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`])) {
		die(`tag ${tag} already exists on origin`);
	}
} catch (e) {
	if (!/already exists on origin/.test(e.message)) console.warn("Warning: could not reach origin.");
}
console.log(`=== release-local ${current} -> ${version} (${tag})${labelSuffix} on ${process.platform} ===`);

// ---- version bump (same files release.mjs updates) -----------------------

sh("node", ["scripts/set-version.mjs", version]);
const platformProblems = platformVersionProblems(readFileSync(join(ROOT, TAURI_CONFIG), "utf8"), version);
if (platformProblems.length) die(`platform version overrides are wrong: ${platformProblems.join("; ")}`);

// ---- checks (the same set the CI runs, minus other-OS jobs) ---------------

if (!skipChecks) {
	sh(PNPM, ["install", "--frozen-lockfile"]);
	sh(PNPM, ["--dir", "app/ui", "install", "--frozen-lockfile"]);
	sh(PNPM, ["--dir", "app/ui", "lint"]);
	sh(PNPM, ["--dir", "app/ui", "build"]);
	sh("cargo", ["fmt", "--check"]);
	sh("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"]);
	// The full Rust suite runs in the Linux test container, not natively.
	sh(PNPM, ["test:rust"]);
} else {
	console.log("(skipping checks: --skip-checks)");
}

// ---- commit + tag --------------------------------------------------------

sh("git", [
	"add",
	"--",
	"package.json",
	"app/ui/package.json",
	TAURI_CONFIG,
	"Cargo.toml",
	"Cargo.lock",
]);
try {
	execFileSync("git", ["commit", "-m", `release: ${tag}${labelSuffix}`], { cwd: ROOT, stdio: "inherit" });
} catch {
	// Already bumped+committed by an earlier interrupted run: reuse it.
	console.log("(commit exists, continuing)");
}
try {
	out("git", ["rev-parse", tag]);
	console.log(`(tag ${tag} exists, continuing)`);
} catch {
	sh("git", ["tag", "-a", tag, "-m", `release: ${tag}${labelSuffix}`]);
}

// ---- builds (whatever this OS allows) ------------------------------------

const artifacts = [];
if (process.platform === "win32") {
	// MSI only.
	sh(PNPM, ["exec", "tauri", "build", "--config", TAURI_CONFIG, "--bundles", "msi"]);
	artifacts.push(...findFiles(join(ROOT, "target/release/bundle/msi"), [".msi"]));
} else if (process.platform === "linux") {
	// deb + AppImage only.
	sh(PNPM, ["exec", "tauri", "build", "--config", TAURI_CONFIG, "--bundles", "deb", "appimage"]);
	artifacts.push(...findFiles(join(ROOT, "target/release/bundle/deb"), [".deb"]));
	artifacts.push(...findFiles(join(ROOT, "target/release/bundle/appimage"), [".AppImage"]));
} else {
	console.log(`(no desktop bundles configured for ${process.platform}; skipping)`);
}
if (artifacts.length === 0) die("no artifacts were built on this machine");
console.log(`\n[ok] built ${artifacts.length} artifact(s):`);
for (const f of artifacts) console.log(`  ${f}`);

// ---- publish ---------------------------------------------------------------

if (!push) {
	console.log(`\nNext (this publishes):\n  git push --atomic origin main ${tag}`);
	console.log(`  gh release create ${tag} --draft --title "PrintNinja ${tag}${labelSuffix}"`);
	console.log(`  gh release upload ${tag} ${artifacts.map((f) => `"${f}"`).join(" ")} --clobber`);
	process.exit(0);
}
sh("git", ["push", "--atomic", "origin", "main", tag]);
try {
	out("gh", ["release", "view", tag]);
	console.log(`(release ${tag} exists, reusing)`);
} catch {
	sh("gh", ["release", "create", tag, "--draft", "--title", `PrintNinja ${tag}${labelSuffix}`]);
}
sh("gh", ["release", "upload", tag, ...artifacts, "--clobber"]);
console.log(`\n[ok] pushed main + ${tag}; draft release updated. Open it on GitHub to publish.`);
