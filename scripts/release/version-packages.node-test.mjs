import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
	changelogSnapshot,
	normalizeAddedBlankLines,
	normalizeChangedChangelogs,
	runVersion,
	writeNormalized,
} from "./version-packages.mjs";

test("cleans generated blank lines while preserving historical bytes and Markdown", () => {
	const original = "# Changelog\n\n## old\n  \nold  \n";
	const added = "## new\n\ntext  \n  \nnext\n```md\n```not-a-close\n  \n```\n    code\n  \n  \n    code\n";
	const generated = `# Changelog\n\n${added}## old\n  \nold  \n`;
	const expected = `# Changelog\n\n${added.replace("text  \n  \nnext", "text  \n\nnext")}## old\n  \nold  \n`;
	assert.equal(normalizeAddedBlankLines(original, generated), expected);
	assert.equal(normalizeAddedBlankLines(expected, expected), expected);
	assert.equal(normalizeAddedBlankLines(original, original), original);
});

test("preserves CRLF and handles an empty candidate", () => {
	assert.equal(normalizeAddedBlankLines("", ""), "");
	assert.equal(
		normalizeAddedBlankLines("# title\r\n", "# title\r\n  \r\ntext  \r\n"),
		"# title\r\n\r\ntext  \r\n",
	);
});

test("version failure retains its exit code and leaves generated files untouched", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "version-packages-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = path.join(root, "packages", "cli");
	await mkdir(packageRoot, { recursive: true });
	const changelog = path.join(packageRoot, "CHANGELOG.md");
	await writeFile(changelog, "# CLI\n");
	assert.equal(await runVersion(root, () => {
		writeFileSync(changelog, "# CLI\n  \n");
		return { status: 17 };
	}), 17);
	assert.equal(await readFile(changelog, "utf8"), "# CLI\n  \n");
	assert.equal(await runVersion(root, () => {
		writeFileSync(changelog, "# CLI\n  \nnew\n  \n");
		return { status: 0 };
	}), 0);
	assert.equal(await readFile(changelog, "utf8"), "# CLI\n  \nnew\n\n");
});

test("rejects a symlinked Changelog before invoking Changesets", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "version-packages-path-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = path.join(root, "packages", "cli");
	await mkdir(packageRoot, { recursive: true });
	const outside = path.join(root, "outside.md");
	await writeFile(outside, "outside\n");
	await symlink(outside, path.join(packageRoot, "CHANGELOG.md"));
	let invoked = false;
	await assert.rejects(changelogSnapshot(root), /not a regular file/u);
	await assert.rejects(runVersion(root, () => { invoked = true; return { status: 0 }; }), /not a regular file/u);
	assert.equal(invoked, false);
	assert.equal(await readFile(outside, "utf8"), "outside\n");
});

test("normalizes a newly generated package Changelog", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "version-packages-new-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = path.join(root, "packages", "new-plugin");
	await mkdir(packageRoot, { recursive: true });
	const changelog = path.join(packageRoot, "CHANGELOG.md");
	assert.equal(await runVersion(root, () => {
		writeFileSync(changelog, "# Plugin\n  \nrelease  \n");
		return { status: 0 };
	}), 0);
	assert.equal(await readFile(changelog, "utf8"), "# Plugin\n\nrelease  \n");
});

test("rejects a packages-root symlink", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "version-packages-root-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "outside"));
	await symlink(path.join(root, "outside"), path.join(root, "packages"));
	await assert.rejects(changelogSnapshot(root), /not a real directory/u);
});

test("rejects a target outside direct package Changelogs", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "version-packages-target-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "packages"));
	const outside = path.join(root, "outside.md");
	await writeFile(outside, "unchanged\n");
	await assert.rejects(
		normalizeChangedChangelogs(root, new Map([[outside, "before\n"]])),
		/outside the package set/u,
	);
	assert.equal(await readFile(outside, "utf8"), "unchanged\n");
});

test("refuses a package-directory symlink swap between check and open", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "version-packages-race-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = path.join(root, "packages", "cli");
	const outsideRoot = path.join(root, "outside");
	await mkdir(packageRoot, { recursive: true });
	await mkdir(outsideRoot);
	const changelog = path.join(packageRoot, "CHANGELOG.md");
	const outside = path.join(outsideRoot, "CHANGELOG.md");
	await writeFile(changelog, "# CLI\n  \n");
	await writeFile(outside, "outside\n");
	await assert.rejects(
		writeNormalized(root, changelog, "# CLI\n  \n", "# CLI\n\n", async () => {
			await rename(packageRoot, path.join(root, "saved-cli"));
			await symlink(outsideRoot, packageRoot);
		}),
		/not a real directory|changed during normalization/u,
	);
	assert.equal(await readFile(outside, "utf8"), "outside\n");
});

test("refuses a packages-root symlink swap between check and open", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "version-packages-root-race-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const packagesRoot = path.join(root, "packages");
	const packageRoot = path.join(packagesRoot, "cli");
	const outsideRoot = path.join(root, "outside");
	await mkdir(packageRoot, { recursive: true });
	await mkdir(path.join(outsideRoot, "cli"), { recursive: true });
	const changelog = path.join(packageRoot, "CHANGELOG.md");
	const outside = path.join(outsideRoot, "cli", "CHANGELOG.md");
	await writeFile(changelog, "# CLI\n  \n");
	await writeFile(outside, "# CLI\n  \n");
	await assert.rejects(
		writeNormalized(root, changelog, "# CLI\n  \n", "# CLI\n\n", async () => {
			await rename(packagesRoot, path.join(root, "saved-packages"));
			await symlink(outsideRoot, packagesRoot);
		}),
		/changed during normalization/u,
	);
	assert.equal(await readFile(outside, "utf8"), "# CLI\n  \n");
});
