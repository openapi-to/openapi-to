import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

function lines(content) {
	return content.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}

function fenceMarker(line, active) {
	const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line.replace(/\r?\n$/u, ""));
	if (!match) return active;
	if (!active) return match[1];
	if (
		match[1][0] === active[0] &&
		match[1].length >= active.length &&
		/^\s*$/u.test(match[2])
	) return undefined;
	return active;
}

function inIndentedCode(content, index) {
	let previous = index - 1;
	while (previous >= 0 && /^\s*$/u.test(content[previous])) previous--;
	let next = index + 1;
	while (next < content.length && /^\s*$/u.test(content[next])) next++;
	return /^(?: {4}|\t)\S/u.test(content[previous] ?? "") &&
		/^(?: {4}|\t)\S/u.test(content[next] ?? "");
}

/** Normalize only newly generated whitespace-only lines outside Markdown code. */
export function normalizeAddedBlankLines(before, after) {
	if (before === after) return after;
	const oldLines = lines(before);
	const newLines = lines(after);
	let start = 0;
	while (start < oldLines.length && oldLines[start] === newLines[start]) start++;
	let oldEnd = oldLines.length;
	let newEnd = newLines.length;
	while (
		oldEnd > start &&
		newEnd > start &&
		oldLines[oldEnd - 1] === newLines[newEnd - 1]
	) {
		oldEnd--;
		newEnd--;
	}
	let fence;
	for (const line of newLines.slice(0, start)) fence = fenceMarker(line, fence);
	for (let index = start; index < newEnd; index++) {
		const line = newLines[index];
		const insideFence = Boolean(fence);
		fence = fenceMarker(line, fence);
		if (insideFence || fence || !/^[\t ]+(?:\r?\n)?$/u.test(line)) continue;
		if (inIndentedCode(newLines, index)) continue;
		newLines[index] = line.replace(/^[\t ]+/u, "");
	}
	return newLines.join("");
}

async function regularFile(filePath) {
	const parent = await lstat(path.dirname(filePath));
	if (!parent.isDirectory() || parent.isSymbolicLink()) {
		throw new Error(`Version Changelog parent is not a real directory: ${filePath}`);
	}
	const details = await lstat(filePath);
	if (!details.isFile() || details.isSymbolicLink()) {
		throw new Error(`Version Changelog is not a regular file: ${filePath}`);
	}
}

function sameFile(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.isFile() && right.isFile();
}

function sameDirectory(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.isDirectory() && right.isDirectory();
}

export async function writeNormalized(root, filePath, generated, normalized, beforeOpen = () => {}) {
	const packagesRoot = path.join(root, "packages");
	const packageRoot = path.dirname(filePath);
	const checkedPackages = await lstat(packagesRoot);
	const checkedPackage = await lstat(packageRoot);
	if (!checkedPackages.isDirectory() || checkedPackages.isSymbolicLink()) {
		throw new Error(`Version packages root is not a real directory: ${packagesRoot}`);
	}
	await regularFile(filePath);
	const checked = await lstat(filePath);
	await beforeOpen();
	const handle = await open(filePath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		const current = await handle.readFile("utf8");
		const stillLinked = await lstat(filePath);
		const stillPackages = await lstat(packagesRoot);
		const stillPackage = await lstat(packageRoot);
		await regularFile(filePath);
		if (!sameDirectory(checkedPackages, stillPackages) ||
			!sameDirectory(checkedPackage, stillPackage) ||
			!sameFile(checked, opened) || !sameFile(opened, stillLinked) || current !== generated) {
			throw new Error(`Version Changelog changed during normalization: ${filePath}`);
		}
		const bytes = Buffer.from(normalized);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
			if (bytesWritten === 0) throw new Error(`Version Changelog write stalled: ${filePath}`);
			offset += bytesWritten;
		}
		await handle.truncate(bytes.length);
	} finally {
		await handle.close();
	}
}

export async function changelogSnapshot(root) {
	const packagesRoot = path.join(root, "packages");
	const packagesDetails = await lstat(packagesRoot);
	if (!packagesDetails.isDirectory() || packagesDetails.isSymbolicLink()) {
		throw new Error(`Version packages root is not a real directory: ${packagesRoot}`);
	}
	const snapshot = new Map();
	for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		const filePath = path.join(packagesRoot, entry.name, "CHANGELOG.md");
		try {
			await regularFile(filePath);
		} catch (error) {
			if (error.code === "ENOENT") {
				snapshot.set(filePath, null);
				continue;
			}
			throw error;
		}
		snapshot.set(filePath, await readFile(filePath, "utf8"));
	}
	return snapshot;
}

export async function normalizeChangedChangelogs(root, before) {
	const packagesRoot = path.join(root, "packages");
	const packagesDetails = await lstat(packagesRoot);
	if (!packagesDetails.isDirectory() || packagesDetails.isSymbolicLink()) {
		throw new Error(`Version packages root is not a real directory: ${packagesRoot}`);
	}
	for (const filePath of before.keys()) {
		const segments = path.relative(packagesRoot, filePath).split(path.sep);
		if (segments.length !== 2 || segments[0] === ".." || segments[1] !== "CHANGELOG.md") {
			throw new Error(`Version Changelog is outside the package set: ${filePath}`);
		}
		try {
			await regularFile(filePath);
		} catch (error) {
			if (error.code === "ENOENT" && before.get(filePath) === null) continue;
			throw error;
		}
	}
	let changed = 0;
	for (const [filePath, original] of before) {
		if (original === null) {
			try {
				await regularFile(filePath);
			} catch (error) {
				if (error.code === "ENOENT") continue;
				throw error;
			}
		}
		const generated = await readFile(filePath, "utf8");
		const normalized = normalizeAddedBlankLines(original ?? "", generated);
		if (normalized !== generated) {
			await writeNormalized(root, filePath, generated, normalized);
			changed++;
		}
	}
	return changed;
}

export async function runVersion(root, invoke = () => spawnSync(
	process.platform === "win32" ? "pnpm.cmd" : "pnpm",
	["exec", "changeset", "version"],
	{ cwd: root, stdio: "inherit", shell: process.platform === "win32" },
)) {
	const before = await changelogSnapshot(root);
	const result = invoke();
	if (result.error) throw result.error;
	if (result.status !== 0) return result.status ?? 1;
	await normalizeChangedChangelogs(root, before);
	return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = await runVersion(repositoryRoot);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
