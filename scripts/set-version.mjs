#!/usr/bin/env node
// Sets the app version in every file the release check compares:
//   package.json, app/ui/package.json, app/tauri.conf.json,
//   Cargo.toml ([workspace.package]), Cargo.lock (every workspace member)
//
//   pnpm version:set 1.0.0 [--dry-run]
//
// It only edits files. It does not commit, tag or push; run `pnpm release`
// afterwards (it will then see all files in sync). `pnpm release` picks a date
// version (YYYY.MMDD.N) by itself and requires it to be higher than the current
// one, so use this script only for a manual override or to repair a drifted file.
//
// For a date version (YYYY.MMDD.N) it also writes the Windows MSI version
// (bundle.windows.wix.version) and the Android versionCode
// (bundle.android.versionCode) into tauri.conf.json, and removes both again for
// any other version. See scripts/lib/version.mjs for why.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBuildable, withVersion } from "./lib/version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
	pkg: "package.json",
	ui: "app/ui/package.json",
	tauri: "app/tauri.conf.json",
	cargo: "Cargo.toml",
	lock: "Cargo.lock",
};

const read = (f) => readFileSync(join(ROOT, f), "utf8");
const write = (f, s) => writeFileSync(join(ROOT, f), s);

function die(msg) {
	console.error(`\nError: ${msg}`);
	process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
if (args.includes("--help") || args.includes("-h") || positional.length !== 1) {
	console.log("Usage: pnpm version:set <X.Y.Z> [--dry-run]");
	process.exit(positional.length === 1 ? 0 : 1);
}
const version = positional[0].replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`"${positional[0]}" is not a version like 1.2.3`);
try {
	assertBuildable(version);
} catch (err) {
	die(err.message);
}

// Replace group 1 + <version> + group 2 and insist on exactly one match, so a
// changed file layout fails loudly instead of silently skipping a file.
function replaceOnce(text, re, file) {
	const count = (text.match(new RegExp(re.source, `${re.flags}g`)) || []).length;
	if (count !== 1) die(`${file}: expected exactly one version to update, found ${count}`);
	return text.replace(re, (_, a, b) => `${a}${version}${b}`);
}

// The members = [...] array of the workspace root.
function workspaceMembers(cargoText) {
	const m = cargoText.match(/^members\s*=\s*\[([\s\S]*?)\]/m);
	if (!m) die(`${FILES.cargo}: could not read the members array`);
	return m[1]
		.split(",")
		.map((s) => s.trim().replace(/^"|"$/g, ""))
		.filter(Boolean);
}

// Version / name of the [package] table only (not [lib], [dependencies], ...).
function cargoPackageField(text, field) {
	let inPackage = false;
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (/^\[.*\]$/.test(t)) {
			inPackage = t === "[package]";
			continue;
		}
		const m = inPackage && t.match(new RegExp(`^${field}\\s*=\\s*"([^"]+)"`));
		if (m) return m[1];
	}
	return "";
}

// Crate name of a workspace member, from its own [package] table.
function crateName(member) {
	const toml = join(member, "Cargo.toml");
	const m = cargoPackageField(read(toml), "name");
	if (!m) die(`could not read the crate name from ${member}/Cargo.toml`);
	return m;
}

// Only the [workspace.package] table, so [workspace.dependencies] versions are
// left alone (they sit on `key = { version = ... }` lines, never bare `version =`).
function bumpWorkspaceToml(text) {
	const lines = text.split("\n"); // keeps any \r, so line endings are preserved
	let inTable = false;
	let done = 0;
	lines.forEach((line, i) => {
		const t = line.trim();
		if (/^\[.*\]$/.test(t)) {
			inTable = t === "[workspace.package]";
		} else if (inTable && /^version\s*=/.test(t)) {
			lines[i] = line.replace(/^(\s*version\s*=\s*")[^"]+(")/, (_, a, b) => `${a}${version}${b}`);
			done++;
		}
	});
	if (done !== 1) die(`${FILES.cargo}: expected one [workspace.package] version, found ${done}`);
	return lines.join("\n");
}

// Cargo.lock entries found line by line (no regex escapes to get mangled when
// the file is copied around). Returns the indexes of the version lines.
function lockVersionLines(lines, crate) {
	const hits = [];
	lines.forEach((line, i) => {
		if (
			line.trim() === "[[package]]" &&
			(lines[i + 1] || "").trim() === `name = "${crate}"` &&
			/^version\s*=/.test((lines[i + 2] || "").trim())
		) {
			hits.push(i + 2);
		}
	});
	return hits;
}

// Every workspace member must carry the same version; bump them all.
function bumpCargoLock(text, members) {
	const lines = text.split("\n"); // keeps any \r, so line endings are preserved
	let bumped = 0;
	for (const member of members) {
		const crate = crateName(member);
		const hits = lockVersionLines(lines, crate);
		if (hits.length !== 1) die(`${FILES.lock}: expected one "${crate}" entry, found ${hits.length}`);
		lines[hits[0]] = lines[hits[0]].replace(/^(\s*version\s*=\s*")[^"]+(")/, (_, a, b) => `${a}${version}${b}`);
		bumped++;
	}
	if (bumped !== members.length) die(`${FILES.lock}: bumped ${bumped} of ${members.length} members`);
	return lines.join("\n");
}

const cargoText = read(FILES.cargo);
const members = workspaceMembers(cargoText);
if (!members.length) die(`${FILES.cargo}: empty members array`);

const updated = {
	[FILES.pkg]: replaceOnce(read(FILES.pkg), /^(\s*"version"\s*:\s*")[^"]+(")/m, FILES.pkg),
	[FILES.ui]: replaceOnce(read(FILES.ui), /^(\s*"version"\s*:\s*")[^"]+(")/m, FILES.ui),
	[FILES.tauri]: withVersion(read(FILES.tauri), version),
	[FILES.cargo]: bumpWorkspaceToml(cargoText),
	[FILES.lock]: bumpCargoLock(read(FILES.lock), members),
};

const crates = members.map(crateName).join(", ");
console.log(`Setting ${crates} to ${version}${dryRun ? " (dry run)" : ""}:`);
for (const [file, text] of Object.entries(updated)) {
	if (!dryRun) write(file, text);
	console.log(`  ${dryRun ? "would update" : "updated"}  ${file}`);
}
