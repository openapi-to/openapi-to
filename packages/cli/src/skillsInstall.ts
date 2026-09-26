import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	link,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const supportedSkillNames = [
	"openapi-to-generate",
	"openapi-to-setup",
] as const;
const manifestByteLimit = 1024 * 1024;
const skillFileByteLimit = 16 * 1024 * 1024;
const distributionByteLimit = 64 * 1024 * 1024;
const installLockName = ".openapi-to-skills-install.lock";
const installJournalName = "transaction.json";
const stagingDirectoryPrefix = ".openapi-to-skills-install-";
const stagingOwnerRecordName = "staging-owner.json";
const stagingOwnerMarkerName = ".openapi-to-staging-owner";
const stagingQuarantineName = "staging-quarantine";
const installJournalByteLimit = 16 * 1024;
const stagingOwnerRecordByteLimit = 4 * 1024;
const targetOwnerMarkerName = ".openapi-to-install-owner";
const activeTransactionNonces = new Set<string>();

type SupportedSkillName = (typeof supportedSkillNames)[number];
export type SkillInstallScope = "project" | "user";

interface SkillFileManifest {
	path: string;
	size: number;
	sha256: string;
}

interface SkillManifest {
	name: SupportedSkillName;
	files: SkillFileManifest[];
}

interface DistributionManifest {
	schemaVersion: 1;
	packageVersion: string;
	skills: SkillManifest[];
}

interface VerifiedSkillFile extends SkillFileManifest {
	bytes: Buffer;
}

interface VerifiedSkill {
	name: SupportedSkillName;
	files: VerifiedSkillFile[];
}

interface InstallJournal {
	schemaVersion: 2;
	packageVersion: string;
	pid: number;
	nonce: string;
	stagingDirectory: string;
	stagingOwnerRecord: typeof stagingOwnerRecordName;
	stagingOwnerMarker: typeof stagingOwnerMarkerName;
	stagingQuarantine: typeof stagingQuarantineName;
	skills: SupportedSkillName[];
}

interface FileIdentity {
	device: string;
	inode: string;
}

interface StagingOwnershipRecord {
	schemaVersion: 1;
	nonce: string;
	stagingDirectory: string;
	stagingIdentity: FileIdentity;
}

interface DestinationIdentity {
	authorityRoot: FileIdentity;
	agentsRoot: FileIdentity;
	skillsRoot: FileIdentity;
	lock: FileIdentity;
}

interface OwnedSkillTarget {
	skill: VerifiedSkill;
	identity: FileIdentity;
	markerPresent: boolean;
}

export interface SkillsInstallRequest {
	dryRun: boolean;
	json: boolean;
	scope: SkillInstallScope;
}

export interface SkillsInstallDependencies {
	assetRoot?: string;
	detectLegacyInstallation?: boolean;
	environment?: NodeJS.ProcessEnv;
	homeDirectory?: () => string;
	workingDirectory?: () => string;
	beforeStaging?: () => Promise<void>;
	beforeStagingDetach?: () => Promise<void>;
	beforeQuarantineCleanup?: () => Promise<void>;
	beforeTargetCommit?: (
		skill: SupportedSkillName,
		index: number,
	) => Promise<void>;
	afterTargetCommit?: (
		skill: SupportedSkillName,
		index: number,
	) => Promise<void>;
	beforeTargetRollback?: (skill: SupportedSkillName) => Promise<void>;
	processId?: number;
	remove?: typeof rm;
	transactionNonce?: () => string;
	writeFile?: typeof writeFile;
}

export interface SkillsInstallOutput {
	success: true;
	command: "skills install";
	mode: "dry-run" | "install";
	host: "codex";
	scope: SkillInstallScope;
	packageVersion: string;
	source: "packaged-npm-assets";
	destinationRoot: string;
	skills: SupportedSkillName[];
	actions: Array<{
		action: "install";
		skill: SupportedSkillName;
		destination: string;
	}>;
	installed: SupportedSkillName[];
	restartRequired: true;
	warnings: string[];
}

export class SkillsInstallError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "SkillsInstallError";
		this.code = code;
	}
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function safeRelativePath(relativePath: unknown): relativePath is string {
	return (
		typeof relativePath === "string" &&
		relativePath.length > 0 &&
		!relativePath.includes("\\") &&
		!relativePath.includes("\0") &&
		!path.posix.isAbsolute(relativePath) &&
		path.posix.normalize(relativePath) === relativePath &&
		relativePath !== "." &&
		!relativePath.startsWith("../") &&
		relativePath.split("/").every((segment) => segment.length > 0)
	);
}

function fail(code: string, message: string): never {
	throw new SkillsInstallError(code, message);
}

async function lstatIfPresent(target: string) {
	try {
		return await lstat(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function fileIdentity(details: { dev: bigint | number; ino: bigint | number }) {
	return {
		device: details.dev.toString(),
		inode: details.ino.toString(),
	};
}

function hasExactKeys(value: object, expected: readonly string[]) {
	return (
		JSON.stringify(Object.keys(value).sort()) ===
		JSON.stringify([...expected].sort())
	);
}

function sameIdentity(
	details: { dev: bigint | number; ino: bigint | number },
	expected: FileIdentity,
) {
	return (
		details.dev.toString() === expected.device &&
		details.ino.toString() === expected.inode
	);
}

function validFileIdentity(value: unknown): value is FileIdentity {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as { device?: unknown }).device === "string" &&
		/^\d{1,40}$/.test((value as { device: string }).device) &&
		typeof (value as { inode?: unknown }).inode === "string" &&
		/^[1-9]\d{0,39}$/.test((value as { inode: string }).inode) &&
		hasExactKeys(value, ["device", "inode"])
	);
}

async function captureDestinationIdentity(
	authorityRoot: string,
	agentsRoot: string,
	skillsRoot: string,
	lockPath: string,
): Promise<DestinationIdentity> {
	try {
		const [authority, agents, root, lock] = await Promise.all([
			lstat(authorityRoot, { bigint: true }),
			lstat(agentsRoot, { bigint: true }),
			lstat(skillsRoot, { bigint: true }),
			lstat(lockPath, { bigint: true }),
		]);
		if (
			authority.isSymbolicLink() ||
			!authority.isDirectory() ||
			agents.isSymbolicLink() ||
			!agents.isDirectory() ||
			root.isSymbolicLink() ||
			!root.isDirectory() ||
			lock.isSymbolicLink() ||
			!lock.isDirectory()
		) {
			return fail(
				"SKILLS_DESTINATION_CHANGED",
				"The Codex Skill destination changed during installation and requires manual inspection.",
			);
		}
		return {
			authorityRoot: fileIdentity(authority),
			agentsRoot: fileIdentity(agents),
			skillsRoot: fileIdentity(root),
			lock: fileIdentity(lock),
		};
	} catch (error) {
		if (error instanceof SkillsInstallError) throw error;
		return fail(
			"SKILLS_DESTINATION_CHANGED",
			"The Codex Skill destination changed during installation and requires manual inspection.",
		);
	}
}

async function assertDestinationStable(
	authorityRoot: string,
	agentsRoot: string,
	skillsRoot: string,
	lockPath: string,
	expected: DestinationIdentity,
) {
	try {
		const [authority, agents, root, lock] = await Promise.all([
			lstat(authorityRoot, { bigint: true }),
			lstat(agentsRoot, { bigint: true }),
			lstat(skillsRoot, { bigint: true }),
			lstat(lockPath, { bigint: true }),
		]);
		if (
			authority.isSymbolicLink() ||
			!authority.isDirectory() ||
			!sameIdentity(authority, expected.authorityRoot) ||
			agents.isSymbolicLink() ||
			!agents.isDirectory() ||
			!sameIdentity(agents, expected.agentsRoot) ||
			root.isSymbolicLink() ||
			!root.isDirectory() ||
			!sameIdentity(root, expected.skillsRoot) ||
			lock.isSymbolicLink() ||
			!lock.isDirectory() ||
			!sameIdentity(lock, expected.lock)
		) {
			return fail(
				"SKILLS_DESTINATION_CHANGED",
				"The Codex Skill destination changed during installation and requires manual inspection.",
			);
		}
	} catch (error) {
		if (error instanceof SkillsInstallError) throw error;
		return fail(
			"SKILLS_DESTINATION_CHANGED",
			"The Codex Skill destination changed during installation and requires manual inspection.",
		);
	}
}

async function destinationIsStable(
	authorityRoot: string,
	agentsRoot: string,
	skillsRoot: string,
	lockPath: string,
	expected: DestinationIdentity,
) {
	try {
		await assertDestinationStable(
			authorityRoot,
			agentsRoot,
			skillsRoot,
			lockPath,
			expected,
		);
		return true;
	} catch {
		return false;
	}
}

function validateManifest(
	value: unknown,
	expectedPackageVersion: string,
): DistributionManifest {
	if (
		!value ||
		typeof value !== "object" ||
		(value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
		(value as { packageVersion?: unknown }).packageVersion !==
			expectedPackageVersion ||
		!Array.isArray((value as { skills?: unknown }).skills)
	) {
		return fail(
			"SKILLS_MANIFEST_INVALID",
			"The packaged Skill manifest is missing, malformed, or does not match this package version.",
		);
	}
	const skills = (value as { skills: unknown[] }).skills;
	if (
		skills.length !== supportedSkillNames.length ||
		skills.some(
			(skill, index) =>
				!skill ||
				typeof skill !== "object" ||
				(skill as { name?: unknown }).name !== supportedSkillNames[index] ||
				!Array.isArray((skill as { files?: unknown }).files),
		)
	) {
		return fail(
			"SKILLS_MANIFEST_INVALID",
			"The packaged Skill manifest must contain exactly the supported Codex Skills in stable order.",
		);
	}
	for (const skill of skills as SkillManifest[]) {
		const paths = new Set<string>();
		if (skill.files.length === 0) {
			return fail(
				"SKILLS_MANIFEST_INVALID",
				`The packaged Skill manifest contains no files for ${skill.name}.`,
			);
		}
		for (const file of skill.files) {
			if (
				!file ||
				typeof file !== "object" ||
				!safeRelativePath(file.path) ||
				!Number.isSafeInteger(file.size) ||
				file.size <= 0 ||
				file.size > skillFileByteLimit ||
				typeof file.sha256 !== "string" ||
				!/^[a-f0-9]{64}$/.test(file.sha256) ||
				paths.has(file.path)
			) {
				return fail(
					"SKILLS_MANIFEST_INVALID",
					`The packaged Skill manifest contains an invalid file record for ${skill.name}.`,
				);
			}
			paths.add(file.path);
		}
		if (!paths.has("SKILL.md")) {
			return fail(
				"SKILLS_MANIFEST_INVALID",
				`The packaged Skill manifest is missing ${skill.name}/SKILL.md.`,
			);
		}
	}
	return value as DistributionManifest;
}

async function listSkillTree(
	root: string,
	relativeDirectory = "",
): Promise<{ directories: string[]; files: string[] }> {
	const directory = path.join(
		root,
		...relativeDirectory.split("/").filter(Boolean),
	);
	const entries = (await readdir(directory, { withFileTypes: true })).sort(
		(left, right) => compareText(left.name, right.name),
	);
	const tree = { directories: [] as string[], files: [] as string[] };
	for (const entry of entries) {
		const relativePath = relativeDirectory
			? `${relativeDirectory}/${entry.name}`
			: entry.name;
		if (!safeRelativePath(relativePath)) {
			return fail(
				"SKILLS_ASSET_INTEGRITY_FAILED",
				"The packaged Skill assets contain an unsafe path.",
			);
		}
		const absolutePath = path.join(root, ...relativePath.split("/"));
		const details = await lstat(absolutePath);
		if (details.isSymbolicLink()) {
			return fail(
				"SKILLS_ASSET_INTEGRITY_FAILED",
				`The packaged Skill assets contain a symlink at ${relativePath}.`,
			);
		}
		if (details.isDirectory()) {
			tree.directories.push(relativePath);
			const nested = await listSkillTree(root, relativePath);
			tree.directories.push(...nested.directories);
			tree.files.push(...nested.files);
			continue;
		}
		if (!details.isFile()) {
			return fail(
				"SKILLS_ASSET_INTEGRITY_FAILED",
				`The packaged Skill assets contain a non-regular file at ${relativePath}.`,
			);
		}
		tree.files.push(relativePath);
	}
	return tree;
}

async function listRegularFiles(
	root: string,
	relativeDirectory = "",
): Promise<string[]> {
	return (await listSkillTree(root, relativeDirectory)).files;
}

async function verifyPackagedSkills(
	assetRoot: string,
	expectedPackageVersion: string,
): Promise<VerifiedSkill[]> {
	const rootDetails = await lstatIfPresent(assetRoot);
	if (!rootDetails?.isDirectory() || rootDetails.isSymbolicLink()) {
		return fail(
			"SKILLS_MANIFEST_INVALID",
			"The packaged Skill asset directory is missing or invalid.",
		);
	}
	const rootEntries = (await readdir(assetRoot, { withFileTypes: true })).sort(
		(left, right) => compareText(left.name, right.name),
	);
	const expectedRootEntries = ["manifest.json", ...supportedSkillNames].sort(
		compareText,
	);
	if (
		JSON.stringify(rootEntries.map(({ name }) => name)) !==
		JSON.stringify(expectedRootEntries)
	) {
		return fail(
			"SKILLS_ASSET_INTEGRITY_FAILED",
			"The packaged Skill asset directory contains an unexpected file set.",
		);
	}
	for (const entry of rootEntries) {
		if (entry.isSymbolicLink()) {
			return fail(
				"SKILLS_ASSET_INTEGRITY_FAILED",
				"The packaged Skill asset directory contains a symlink.",
			);
		}
		if (
			(entry.name === "manifest.json" && !entry.isFile()) ||
			(entry.name !== "manifest.json" && !entry.isDirectory())
		) {
			return fail(
				"SKILLS_ASSET_INTEGRITY_FAILED",
				"The packaged Skill asset directory has an invalid structure.",
			);
		}
	}
	const manifestPath = path.join(assetRoot, "manifest.json");
	const manifestDetails = await lstat(manifestPath);
	if (
		manifestDetails.isSymbolicLink() ||
		!manifestDetails.isFile() ||
		manifestDetails.size > manifestByteLimit
	) {
		return fail(
			"SKILLS_MANIFEST_INVALID",
			"The packaged Skill manifest is missing or exceeds its safety limit.",
		);
	}
	let parsedManifest: unknown;
	try {
		parsedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch {
		return fail(
			"SKILLS_MANIFEST_INVALID",
			"The packaged Skill manifest is not valid JSON.",
		);
	}
	const manifest = validateManifest(parsedManifest, expectedPackageVersion);
	let totalBytes = 0;
	const verified: VerifiedSkill[] = [];
	for (const skill of manifest.skills) {
		const skillRoot = path.join(assetRoot, skill.name);
		const rootDetails = await lstat(skillRoot);
		if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
			return fail(
				"SKILLS_ASSET_INTEGRITY_FAILED",
				`The packaged Skill directory is invalid for ${skill.name}.`,
			);
		}
		const actualPaths = await listRegularFiles(skillRoot);
		const declaredPaths = skill.files.map(({ path }) => path);
		if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) {
			return fail(
				"SKILLS_ASSET_INTEGRITY_FAILED",
				`The packaged file set does not match the manifest for ${skill.name}.`,
			);
		}
		const files: VerifiedSkillFile[] = [];
		for (const file of skill.files) {
			const absolutePath = path.join(skillRoot, ...file.path.split("/"));
			const details = await lstat(absolutePath);
			if (
				details.isSymbolicLink() ||
				!details.isFile() ||
				details.size !== file.size
			) {
				return fail(
					"SKILLS_ASSET_INTEGRITY_FAILED",
					`The packaged bytes do not match the manifest for ${skill.name}/${file.path}.`,
				);
			}
			totalBytes += details.size;
			if (totalBytes > distributionByteLimit) {
				return fail(
					"SKILLS_ASSET_INTEGRITY_FAILED",
					"The packaged Skill assets exceed their safety limit.",
				);
			}
			const bytes = await readFile(absolutePath);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			if (sha256 !== file.sha256) {
				return fail(
					"SKILLS_ASSET_INTEGRITY_FAILED",
					`The packaged bytes do not match the manifest for ${skill.name}/${file.path}.`,
				);
			}
			files.push({ ...file, bytes });
		}
		verified.push({ name: skill.name, files });
	}
	return verified;
}

interface ResolvedSkillDestination {
	scope: SkillInstallScope;
	authorityRoot: string;
	agentsRoot: string;
	skillsRoot: string;
}

function resolveSkillDestination(
	scope: SkillInstallScope,
	homeDirectory: () => string,
	workingDirectory: () => string,
): ResolvedSkillDestination {
	if (scope !== "project" && scope !== "user") {
		return fail(
			"SKILLS_SCOPE_REQUIRED",
			"`--scope` is required; choose `--scope project` or `--scope user`.",
		);
	}
	const rawAuthorityRoot =
		scope === "project" ? workingDirectory() : homeDirectory();
	if (
		typeof rawAuthorityRoot !== "string" ||
		rawAuthorityRoot.length === 0 ||
		!path.isAbsolute(rawAuthorityRoot)
	) {
		return fail(
			"SKILLS_DESTINATION_INVALID",
			"The Skill scope authority root must be a non-empty absolute path.",
		);
	}
	const authorityRoot = path.resolve(rawAuthorityRoot);
	if (authorityRoot === path.parse(authorityRoot).root) {
		return fail(
			"SKILLS_DESTINATION_INVALID",
			"The Skill scope authority root must not be a filesystem root.",
		);
	}
	const agentsRoot = path.resolve(authorityRoot, ".agents");
	const skillsRoot = path.resolve(agentsRoot, "skills");
	if (
		path.relative(authorityRoot, agentsRoot) !== ".agents" ||
		path.relative(agentsRoot, skillsRoot) !== "skills"
	) {
		return fail(
			"SKILLS_DESTINATION_INVALID",
			"The Agent Skills destination escapes its authorized scope root.",
		);
	}
	return { scope, authorityRoot, agentsRoot, skillsRoot };
}

async function detectLegacyInstallation(
	homeDirectory: () => string,
): Promise<string[]> {
	const rawHome = homeDirectory();
	if (typeof rawHome !== "string" || !path.isAbsolute(rawHome)) return [];
	const legacyRoot = path.resolve(rawHome, ".codex", "skills");
	const warnings: string[] = [];
	for (const skill of supportedSkillNames) {
		if (!(await lstatIfPresent(path.join(legacyRoot, skill)))) continue;
		warnings.push(
			`SKILLS_LEGACY_INSTALL_DETECTED: Existing legacy Skill installation at ${path.join(legacyRoot, skill)}. No automatic migration was performed.`,
		);
	}
	return warnings;
}

async function preflightDestination(
	authorityRoot: string,
	agentsRoot: string,
	skillsRoot: string,
	options: { checkConflicts?: boolean; checkLock?: boolean } = {},
): Promise<{
	authorityRootPresent: boolean;
	agentsRootPresent: boolean;
	skillsRootPresent: boolean;
}> {
	let authorityRootDetails: Awaited<ReturnType<typeof lstat>> | undefined;
	let agentsRootDetails: Awaited<ReturnType<typeof lstat>> | undefined;
	let skillsRootDetails: Awaited<ReturnType<typeof lstat>> | undefined;
	try {
		authorityRootDetails = await lstatIfPresent(authorityRoot);
		agentsRootDetails = await lstatIfPresent(agentsRoot);
		skillsRootDetails = await lstatIfPresent(skillsRoot);
	} catch {
		return fail(
			"SKILLS_DESTINATION_INVALID",
			"The Codex Skill destination cannot be inspected safely.",
		);
	}
	if (
		authorityRootDetails &&
		(authorityRootDetails.isSymbolicLink() ||
			!authorityRootDetails.isDirectory())
	) {
		return fail(
			"SKILLS_DESTINATION_INVALID",
			"The Skill scope authority root must be a real directory, not a file or symlink.",
		);
	}
	if (
		agentsRootDetails &&
		(agentsRootDetails.isSymbolicLink() || !agentsRootDetails.isDirectory())
	) {
		return fail(
			"SKILLS_DESTINATION_INVALID",
			"The .agents directory must be a real directory, not a file or symlink.",
		);
	}
	if (
		skillsRootDetails &&
		(skillsRootDetails.isSymbolicLink() || !skillsRootDetails.isDirectory())
	) {
		return fail(
			"SKILLS_DESTINATION_INVALID",
			"The Codex skills root must be a real directory, not a file or symlink.",
		);
	}
	if (skillsRootDetails) {
		try {
			await access(skillsRoot, constants.W_OK);
		} catch {
			return fail(
				"SKILLS_DESTINATION_INVALID",
				"The Agent Skills root is not writable.",
			);
		}
	}
	if (options.checkConflicts !== false) {
		const conflicts: SupportedSkillName[] = [];
		for (const name of supportedSkillNames) {
			try {
				if (await lstatIfPresent(path.join(skillsRoot, name))) {
					conflicts.push(name);
				}
			} catch {
				return fail(
					"SKILLS_DESTINATION_INVALID",
					"The Agent Skill destinations cannot be inspected safely.",
				);
			}
		}
		if (conflicts.length > 0) {
			return fail(
				"SKILLS_DESTINATION_CONFLICT",
				`Agent Skill destination already exists for: ${conflicts.join(", ")}. Inspect it manually; this installer never overwrites or merges.`,
			);
		}
	}
	if (
		options.checkLock !== false &&
		(await lstatIfPresent(path.join(skillsRoot, installLockName)))
	) {
		return fail(
			"SKILLS_INSTALL_BUSY",
			"An Agent Skill installation is already active or requires manual inspection.",
		);
	}
	return {
		authorityRootPresent: authorityRootDetails !== undefined,
		agentsRootPresent: agentsRootDetails !== undefined,
		skillsRootPresent: skillsRootDetails !== undefined,
	};
}

async function ensureDestinationDirectories(
	agentsRoot: string,
	skillsRoot: string,
): Promise<void> {
	for (const directory of [agentsRoot, skillsRoot]) {
		try {
			await mkdir(directory, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const details = await lstat(directory);
		if (details.isSymbolicLink() || !details.isDirectory()) {
			return fail(
				"SKILLS_DESTINATION_INVALID",
				"The Agent Skills destination changed during installation.",
			);
		}
	}
}

async function writeStagedSkills(
	stagingRoot: string,
	skills: VerifiedSkill[],
	write: typeof writeFile,
) {
	for (const skill of skills) {
		for (const file of skill.files) {
			const destination = path.join(
				stagingRoot,
				skill.name,
				...file.path.split("/"),
			);
			await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
			await write(destination, file.bytes, { flag: "wx", mode: 0o644 });
		}
	}
}

async function verifyInstalledSkill(
	root: string,
	skill: VerifiedSkill,
): Promise<void> {
	const actualPaths = await listRegularFiles(root);
	if (
		JSON.stringify(actualPaths) !==
		JSON.stringify(skill.files.map(({ path }) => path))
	) {
		return fail(
			"SKILLS_INSTALL_VERIFICATION_FAILED",
			`Installed file verification failed for ${skill.name}.`,
		);
	}
	for (const file of skill.files) {
		const bytes = await readFile(path.join(root, ...file.path.split("/")));
		if (
			bytes.byteLength !== file.size ||
			createHash("sha256").update(bytes).digest("hex") !== file.sha256
		) {
			return fail(
				"SKILLS_INSTALL_VERIFICATION_FAILED",
				`Installed byte verification failed for ${skill.name}/${file.path}.`,
			);
		}
	}
}

export interface CodexSkillsInspection {
	destinationRoot: string;
	status: "missing" | "current" | "conflict";
	current: SupportedSkillName[];
	missing: SupportedSkillName[];
	conflicting: SupportedSkillName[];
}

/**
 * Read-only inspection shared by the setup bootstrap and the standalone
 * installer. Existing targets are only considered reusable when every
 * packaged byte matches; the standalone installer keeps its stricter
 * existing-target rejection contract.
 */
export async function inspectCodexSkills(
	scope: SkillInstallScope,
	packageVersion: string,
	dependencies: SkillsInstallDependencies = {},
): Promise<CodexSkillsInspection> {
	const verifiedSkills = await verifyPackagedSkills(
		dependencies.assetRoot ?? packagedAssetRoot(),
		packageVersion,
	);
	const destination = resolveSkillDestination(
		scope,
		dependencies.homeDirectory ?? homedir,
		dependencies.workingDirectory ?? process.cwd,
	);
	await preflightDestination(
		destination.authorityRoot,
		destination.agentsRoot,
		destination.skillsRoot,
		{ checkConflicts: false, checkLock: true },
	);
	const current: SupportedSkillName[] = [];
	const missing: SupportedSkillName[] = [];
	const conflicting: SupportedSkillName[] = [];
	for (const skill of verifiedSkills) {
		const target = path.join(destination.skillsRoot, skill.name);
		const details = await lstatIfPresent(target);
		if (!details) {
			missing.push(skill.name);
			continue;
		}
		if (details.isSymbolicLink() || !details.isDirectory()) {
			conflicting.push(skill.name);
			continue;
		}
		try {
			await verifyInstalledSkill(target, skill);
			current.push(skill.name);
		} catch {
			conflicting.push(skill.name);
		}
	}
	const status =
		conflicting.length > 0 || (current.length > 0 && missing.length > 0)
			? "conflict"
			: current.length === verifiedSkills.length
				? "current"
				: "missing";
	return {
		destinationRoot: destination.skillsRoot,
		status,
		current,
		missing,
		conflicting,
	};
}

function expectedSkillDirectories(skill: VerifiedSkill) {
	const directories = new Set<string>();
	for (const file of skill.files) {
		const segments = file.path.split("/");
		for (let index = 1; index < segments.length; index += 1) {
			directories.add(segments.slice(0, index).join("/"));
		}
	}
	return directories;
}

async function captureOwnedSkillTarget(
	root: string,
	skill: VerifiedSkill,
	markerPresent: boolean,
): Promise<OwnedSkillTarget> {
	const details = await lstat(root, { bigint: true });
	if (details.isSymbolicLink() || !details.isDirectory()) {
		return fail(
			"SKILLS_DESTINATION_CHANGED",
			`The Codex Skill destination changed during installation for ${skill.name}.`,
		);
	}
	return {
		skill,
		identity: fileIdentity(details),
		markerPresent,
	};
}

async function assertOwnedSkillTarget(
	root: string,
	target: OwnedSkillTarget,
	code:
		| "SKILLS_DESTINATION_CHANGED"
		| "SKILLS_INSTALL_RECOVERY_REQUIRED" = "SKILLS_DESTINATION_CHANGED",
) {
	try {
		const details = await lstat(root, { bigint: true });
		if (
			details.isSymbolicLink() ||
			!details.isDirectory() ||
			!sameIdentity(details, target.identity)
		) {
			return fail(
				code,
				`The Codex Skill destination changed during installation for ${target.skill.name}.`,
			);
		}
	} catch (error) {
		if (error instanceof SkillsInstallError) throw error;
		return fail(
			code,
			`The Codex Skill destination changed during installation for ${target.skill.name}.`,
		);
	}
}

function ownerMarkerBytes(nonce: string) {
	return Buffer.from(`${nonce}\n`, "utf8");
}

async function verifyRemovableSkillTarget(
	root: string,
	target: OwnedSkillTarget,
	nonce: string,
	allowIncompleteWithoutMarker = false,
) {
	await assertOwnedSkillTarget(
		root,
		target,
		"SKILLS_INSTALL_RECOVERY_REQUIRED",
	);
	const tree = await listSkillTree(root);
	const expectedDirectories = expectedSkillDirectories(target.skill);
	if (
		tree.directories.some((directory) => !expectedDirectories.has(directory))
	) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			`Codex Skill installation recovery found unexpected directories for ${target.skill.name}.`,
		);
	}
	const expectedFiles = new Map(
		target.skill.files.map((file) => [file.path, file]),
	);
	const markerPath = path.join(root, targetOwnerMarkerName);
	const markerListed = tree.files.includes(targetOwnerMarkerName);
	if (target.markerPresent !== markerListed) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			`Codex Skill installation recovery could not prove ownership for ${target.skill.name}.`,
		);
	}
	if (markerListed) {
		const marker = await readFile(markerPath);
		if (!marker.equals(ownerMarkerBytes(nonce))) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				`Codex Skill installation recovery found invalid ownership for ${target.skill.name}.`,
			);
		}
	}
	const actualSkillFiles = tree.files.filter(
		(file) => file !== targetOwnerMarkerName,
	);
	for (const relativePath of actualSkillFiles) {
		const expected = expectedFiles.get(relativePath);
		if (!expected) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				`Codex Skill installation recovery found unexpected files for ${target.skill.name}.`,
			);
		}
		const bytes = await readFile(path.join(root, ...relativePath.split("/")));
		if (
			bytes.byteLength !== expected.size ||
			createHash("sha256").update(bytes).digest("hex") !== expected.sha256
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				`Codex Skill installation recovery found changed bytes for ${target.skill.name}.`,
			);
		}
	}
	if (
		!markerListed &&
		!allowIncompleteWithoutMarker &&
		actualSkillFiles.length !== target.skill.files.length
	) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			`Codex Skill installation recovery could not prove a complete target for ${target.skill.name}.`,
		);
	}
	await assertOwnedSkillTarget(
		root,
		target,
		"SKILLS_INSTALL_RECOVERY_REQUIRED",
	);
}

async function materializeReservedSkill(
	root: string,
	target: OwnedSkillTarget,
	nonce: string,
	write: typeof writeFile,
) {
	await write(path.join(root, targetOwnerMarkerName), ownerMarkerBytes(nonce), {
		flag: "wx",
		mode: 0o600,
	});
	target.markerPresent = true;
	await assertOwnedSkillTarget(root, target);
	await verifyRemovableSkillTarget(root, target, nonce, true);
	for (const file of target.skill.files) {
		const destination = path.join(root, ...file.path.split("/"));
		await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
		await verifyRemovableSkillTarget(root, target, nonce, true);
		await write(destination, file.bytes, { flag: "wx", mode: 0o644 });
		await verifyRemovableSkillTarget(root, target, nonce, true);
	}
	await unlink(path.join(root, targetOwnerMarkerName));
	target.markerPresent = false;
	await assertOwnedSkillTarget(root, target);
	await verifyInstalledSkill(root, target.skill);
	await assertOwnedSkillTarget(root, target);
}

function validateTransactionNonce(nonce: string) {
	if (!/^[a-zA-Z0-9-]{1,128}$/.test(nonce)) {
		return fail(
			"SKILLS_INSTALL_FAILED",
			"Codex Skill installation could not create a safe transaction identifier.",
		);
	}
	return nonce;
}

function stagingOwnerMarkerBytes(nonce: string) {
	return Buffer.from(`openapi-to-staging:${nonce}\n`, "utf8");
}

async function createStagingOwnership(
	lockPath: string,
	stagingRoot: string,
	nonce: string,
): Promise<StagingOwnershipRecord> {
	const details = await lstat(stagingRoot, { bigint: true });
	if (
		details.isSymbolicLink() ||
		!details.isDirectory() ||
		details.ino === 0n
	) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging ownership could not be established safely.",
		);
	}
	await writeFile(
		path.join(stagingRoot, stagingOwnerMarkerName),
		stagingOwnerMarkerBytes(nonce),
		{ flag: "wx", mode: 0o600 },
	);
	const record: StagingOwnershipRecord = {
		schemaVersion: 1,
		nonce,
		stagingDirectory: path.basename(stagingRoot),
		stagingIdentity: fileIdentity(details),
	};
	await writeExclusiveRecordAtomically(
		path.join(lockPath, stagingOwnerRecordName),
		`${stagingOwnerRecordName}.tmp-${nonce}`,
		record,
	);
	return record;
}

function validateInstallJournal(
	value: unknown,
	expectedPackageVersion: string,
): InstallJournal {
	if (
		!value ||
		typeof value !== "object" ||
		(value as { schemaVersion?: unknown }).schemaVersion !== 2 ||
		(value as { packageVersion?: unknown }).packageVersion !==
			expectedPackageVersion ||
		!Number.isSafeInteger((value as { pid?: unknown }).pid) ||
		((value as { pid: number }).pid ?? 0) <= 0 ||
		typeof (value as { nonce?: unknown }).nonce !== "string" ||
		!Array.isArray((value as { skills?: unknown }).skills) ||
		!hasExactKeys(value, [
			"schemaVersion",
			"packageVersion",
			"pid",
			"nonce",
			"stagingDirectory",
			"stagingOwnerRecord",
			"stagingOwnerMarker",
			"stagingQuarantine",
			"skills",
		])
	) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"An interrupted Codex Skill installation requires manual inspection.",
		);
	}
	const journal = value as InstallJournal;
	if (
		!/^[a-zA-Z0-9-]{1,128}$/.test(journal.nonce) ||
		journal.stagingDirectory !== `${stagingDirectoryPrefix}${journal.nonce}` ||
		journal.stagingOwnerRecord !== stagingOwnerRecordName ||
		journal.stagingOwnerMarker !== stagingOwnerMarkerName ||
		journal.stagingQuarantine !== stagingQuarantineName ||
		JSON.stringify(journal.skills) !== JSON.stringify(supportedSkillNames)
	) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"An interrupted Codex Skill installation requires manual inspection.",
		);
	}
	return journal;
}

function validateStagingOwnershipRecord(
	value: unknown,
	journal: InstallJournal,
): StagingOwnershipRecord {
	if (
		!value ||
		typeof value !== "object" ||
		(value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
		(value as { nonce?: unknown }).nonce !== journal.nonce ||
		(value as { stagingDirectory?: unknown }).stagingDirectory !==
			journal.stagingDirectory ||
		!validFileIdentity(
			(value as { stagingIdentity?: unknown }).stagingIdentity,
		) ||
		!hasExactKeys(value, [
			"schemaVersion",
			"nonce",
			"stagingDirectory",
			"stagingIdentity",
		])
	) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging ownership evidence requires manual inspection.",
		);
	}
	return value as StagingOwnershipRecord;
}

async function writeInstallJournal(
	lockPath: string,
	journal: InstallJournal,
): Promise<void> {
	await writeExclusiveRecordAtomically(
		path.join(lockPath, installJournalName),
		`${installJournalName}.tmp-${journal.nonce}`,
		journal,
	);
}

async function writeExclusiveRecordAtomically(
	destination: string,
	temporaryName: string,
	value: object,
): Promise<void> {
	const temporaryPath = path.join(path.dirname(destination), temporaryName);
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	await link(temporaryPath, destination);
	await unlink(temporaryPath);
}

async function readInstallJournal(
	lockPath: string,
	expectedPackageVersion: string,
): Promise<InstallJournal> {
	try {
		const entries = await readdir(lockPath, { withFileTypes: true });
		if (
			entries.length < 1 ||
			entries.length > 3 ||
			!entries.some((entry) => entry.name === installJournalName) ||
			entries.some((entry) => {
				if (entry.isSymbolicLink()) return true;
				if ([installJournalName, stagingOwnerRecordName].includes(entry.name)) {
					return !entry.isFile();
				}
				if (entry.name === stagingQuarantineName) {
					return !entry.isDirectory();
				}
				return true;
			})
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"An interrupted Codex Skill installation requires manual inspection.",
			);
		}
		const journalPath = path.join(lockPath, installJournalName);
		const details = await lstat(journalPath);
		if (
			details.isSymbolicLink() ||
			!details.isFile() ||
			details.size <= 0 ||
			details.size > installJournalByteLimit
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"An interrupted Codex Skill installation requires manual inspection.",
			);
		}
		return validateInstallJournal(
			JSON.parse(await readFile(journalPath, "utf8")),
			expectedPackageVersion,
		);
	} catch (error) {
		if (error instanceof SkillsInstallError) throw error;
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"An interrupted Codex Skill installation requires manual inspection.",
		);
	}
}

async function readStagingOwnershipRecord(
	lockPath: string,
	journal: InstallJournal,
): Promise<StagingOwnershipRecord | undefined> {
	try {
		const recordPath = path.join(lockPath, journal.stagingOwnerRecord);
		const details = await lstatIfPresent(recordPath);
		if (!details) return undefined;
		if (
			details.isSymbolicLink() ||
			!details.isFile() ||
			details.size <= 0 ||
			details.size > stagingOwnerRecordByteLimit
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging ownership evidence requires manual inspection.",
			);
		}
		return validateStagingOwnershipRecord(
			JSON.parse(await readFile(recordPath, "utf8")),
			journal,
		);
	} catch (error) {
		if (error instanceof SkillsInstallError) throw error;
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging ownership evidence requires manual inspection.",
		);
	}
}

function processIsActive(pid: number, nonce: string) {
	if (pid === process.pid) return activeTransactionNonces.has(nonce);
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

async function verifyOwnedStagingDirectory(
	skillsRoot: string,
	lockPath: string,
	candidateRoot: string,
	journal: InstallJournal,
	ownership: StagingOwnershipRecord,
	skills: VerifiedSkill[],
) {
	try {
		const expectedStagingRoot = path.join(skillsRoot, journal.stagingDirectory);
		const expectedQuarantineRoot = path.join(
			lockPath,
			journal.stagingQuarantine,
		);
		if (
			(candidateRoot !== expectedStagingRoot &&
				candidateRoot !== expectedQuarantineRoot) ||
			ownership.nonce !== journal.nonce ||
			ownership.stagingDirectory !== journal.stagingDirectory
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging ownership could not be proven.",
			);
		}
		const details = await lstat(candidateRoot, { bigint: true });
		if (
			details.isSymbolicLink() ||
			!details.isDirectory() ||
			!sameIdentity(details, ownership.stagingIdentity)
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging ownership could not be proven.",
			);
		}
		const markerPath = path.join(candidateRoot, journal.stagingOwnerMarker);
		const markerDetails = await lstat(markerPath);
		const expectedMarker = stagingOwnerMarkerBytes(journal.nonce);
		if (
			markerDetails.isSymbolicLink() ||
			!markerDetails.isFile() ||
			markerDetails.size !== expectedMarker.byteLength ||
			!(await readFile(markerPath)).equals(expectedMarker)
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging ownership marker could not be proven.",
			);
		}
		const tree = await listSkillTree(candidateRoot);
		const expectedDirectories = new Set<string>();
		const expectedFiles = new Map<string, VerifiedSkillFile>();
		for (const skill of skills) {
			expectedDirectories.add(skill.name);
			for (const directory of expectedSkillDirectories(skill)) {
				expectedDirectories.add(`${skill.name}/${directory}`);
			}
			for (const file of skill.files) {
				expectedFiles.set(`${skill.name}/${file.path}`, file);
			}
		}
		if (
			tree.directories.some(
				(directory) => !expectedDirectories.has(directory),
			) ||
			tree.files.some(
				(file) =>
					file !== journal.stagingOwnerMarker && !expectedFiles.has(file),
			)
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging contains unexplained entries.",
			);
		}
		for (const relativePath of tree.files) {
			if (relativePath === journal.stagingOwnerMarker) continue;
			const expected = expectedFiles.get(relativePath);
			if (!expected) {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"Codex Skill staging contains unexplained entries.",
				);
			}
			const bytes = await readFile(
				path.join(candidateRoot, ...relativePath.split("/")),
			);
			if (
				bytes.byteLength !== expected.size ||
				createHash("sha256").update(bytes).digest("hex") !== expected.sha256
			) {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"Codex Skill staging contains changed bytes.",
				);
			}
		}
		const finalDetails = await lstat(candidateRoot, { bigint: true });
		if (
			finalDetails.isSymbolicLink() ||
			!finalDetails.isDirectory() ||
			!sameIdentity(finalDetails, ownership.stagingIdentity)
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging ownership changed during verification.",
			);
		}
	} catch (error) {
		if (
			error instanceof SkillsInstallError &&
			error.code === "SKILLS_INSTALL_RECOVERY_REQUIRED"
		) {
			throw error;
		}
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging ownership could not be proven.",
		);
	}
}

async function assertOwnedStagingRoot(
	candidateRoot: string,
	ownership: StagingOwnershipRecord,
) {
	try {
		const details = await lstat(candidateRoot, { bigint: true });
		if (
			details.isSymbolicLink() ||
			!details.isDirectory() ||
			!sameIdentity(details, ownership.stagingIdentity)
		) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging ownership changed during cleanup.",
			);
		}
	} catch (error) {
		if (error instanceof SkillsInstallError) throw error;
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging ownership changed during cleanup.",
		);
	}
}

async function removeVerifiedStagingTree(
	candidateRoot: string,
	journal: InstallJournal,
	ownership: StagingOwnershipRecord,
	skills: VerifiedSkill[],
) {
	try {
		const expectedFiles = skills
			.flatMap((skill) =>
				skill.files.map((file) => `${skill.name}/${file.path}`),
			)
			.sort(compareText);
		for (const relativePath of expectedFiles) {
			await assertOwnedStagingRoot(candidateRoot, ownership);
			const target = path.join(candidateRoot, ...relativePath.split("/"));
			const details = await lstatIfPresent(target);
			if (!details) continue;
			if (details.isSymbolicLink() || !details.isFile()) {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"Codex Skill staging entries changed during cleanup.",
				);
			}
			await unlink(target);
		}
		const expectedDirectories = skills
			.flatMap((skill) => [
				skill.name,
				...[...expectedSkillDirectories(skill)].map(
					(directory) => `${skill.name}/${directory}`,
				),
			])
			.sort((left, right) => {
				const depthDifference =
					right.split("/").length - left.split("/").length;
				return depthDifference || compareText(right, left);
			});
		for (const relativePath of expectedDirectories) {
			await assertOwnedStagingRoot(candidateRoot, ownership);
			const target = path.join(candidateRoot, ...relativePath.split("/"));
			const details = await lstatIfPresent(target);
			if (!details) continue;
			if (details.isSymbolicLink() || !details.isDirectory()) {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"Codex Skill staging entries changed during cleanup.",
				);
			}
			await rmdir(target);
		}
		await assertOwnedStagingRoot(candidateRoot, ownership);
		const markerPath = path.join(candidateRoot, journal.stagingOwnerMarker);
		const markerDetails = await lstatIfPresent(markerPath);
		if (markerDetails) {
			if (markerDetails.isSymbolicLink() || !markerDetails.isFile()) {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"Codex Skill staging ownership marker changed during cleanup.",
				);
			}
			await unlink(markerPath);
		}
		await assertOwnedStagingRoot(candidateRoot, ownership);
		await rmdir(candidateRoot);
	} catch (error) {
		if (
			error instanceof SkillsInstallError &&
			error.code === "SKILLS_INSTALL_RECOVERY_REQUIRED"
		) {
			throw error;
		}
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging cleanup requires manual inspection.",
		);
	}
}

async function removeOwnedStagingDirectory(
	authorityRoot: string,
	agentsRoot: string,
	skillsRoot: string,
	lockPath: string,
	stagingRoot: string,
	identity: DestinationIdentity,
	journal: InstallJournal,
	ownership: StagingOwnershipRecord | undefined,
	skills: VerifiedSkill[],
	beforeStagingDetach?: SkillsInstallDependencies["beforeStagingDetach"],
	beforeQuarantineCleanup?: SkillsInstallDependencies["beforeQuarantineCleanup"],
) {
	await assertDestinationStable(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		identity,
	);
	const stagingDetails = await lstatIfPresent(stagingRoot);
	const quarantineRoot = path.join(lockPath, journal.stagingQuarantine);
	const quarantineDetails = await lstatIfPresent(quarantineRoot);
	if (stagingDetails && quarantineDetails) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging cleanup contains ambiguous paths.",
		);
	}
	if (!stagingDetails && !quarantineDetails) return;
	if (!ownership) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging ownership evidence is missing.",
		);
	}
	if (stagingDetails) {
		await verifyOwnedStagingDirectory(
			skillsRoot,
			lockPath,
			stagingRoot,
			journal,
			ownership,
			skills,
		);
		await beforeStagingDetach?.();
		await assertDestinationStable(
			authorityRoot,
			agentsRoot,
			skillsRoot,
			lockPath,
			identity,
		);
		try {
			await rename(stagingRoot, quarantineRoot);
		} catch {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging could not be detached safely.",
			);
		}
	}
	await assertDestinationStable(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		identity,
	);
	await verifyOwnedStagingDirectory(
		skillsRoot,
		lockPath,
		quarantineRoot,
		journal,
		ownership,
		skills,
	);
	await beforeQuarantineCleanup?.();
	await removeVerifiedStagingTree(quarantineRoot, journal, ownership, skills);
	await assertDestinationStable(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		identity,
	);
}

async function cleanupTransaction(
	authorityRoot: string,
	agentsRoot: string,
	skillsRoot: string,
	lockPath: string,
	stagingRoot: string,
	identity: DestinationIdentity,
	journal: InstallJournal,
	skills: VerifiedSkill[],
	beforeStagingDetach?: SkillsInstallDependencies["beforeStagingDetach"],
	beforeQuarantineCleanup?: SkillsInstallDependencies["beforeQuarantineCleanup"],
) {
	const ownership = await readStagingOwnershipRecord(lockPath, journal);
	await removeOwnedStagingDirectory(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		stagingRoot,
		identity,
		journal,
		ownership,
		skills,
		beforeStagingDetach,
		beforeQuarantineCleanup,
	);
	await assertDestinationStable(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		identity,
	);
	if (ownership) {
		await unlink(path.join(lockPath, journal.stagingOwnerRecord));
		await assertDestinationStable(
			authorityRoot,
			agentsRoot,
			skillsRoot,
			lockPath,
			identity,
		);
	}
	await unlink(path.join(lockPath, installJournalName)).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		},
	);
	await assertDestinationStable(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		identity,
	);
	await rmdir(lockPath);
}

async function recoverInterruptedInstallation(
	authorityRoot: string,
	agentsRoot: string,
	skillsRoot: string,
	packageVersion: string,
	skills: VerifiedSkill[],
	beforeStagingDetach?: SkillsInstallDependencies["beforeStagingDetach"],
	beforeQuarantineCleanup?: SkillsInstallDependencies["beforeQuarantineCleanup"],
) {
	const lockPath = path.join(skillsRoot, installLockName);
	const lockDetails = await lstatIfPresent(lockPath);
	if (!lockDetails) return false;
	if (lockDetails.isSymbolicLink() || !lockDetails.isDirectory()) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"An interrupted Codex Skill installation requires manual inspection.",
		);
	}
	const initialLockEntries = await readdir(lockPath);
	if (initialLockEntries.length === 0) {
		const identity = await captureDestinationIdentity(
			authorityRoot,
			agentsRoot,
			skillsRoot,
			lockPath,
		);
		await assertDestinationStable(
			authorityRoot,
			agentsRoot,
			skillsRoot,
			lockPath,
			identity,
		);
		await rmdir(lockPath);
		return false;
	}
	const journal = await readInstallJournal(lockPath, packageVersion);
	if (processIsActive(journal.pid, journal.nonce)) {
		return fail(
			"SKILLS_INSTALL_BUSY",
			"A Codex Skill installation is already active or requires manual inspection.",
		);
	}
	const stagingRoot = path.join(skillsRoot, journal.stagingDirectory);
	const identity = await captureDestinationIdentity(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
	);
	await assertDestinationStable(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		identity,
	);
	const ownership = await readStagingOwnershipRecord(lockPath, journal);
	const stagingDetails = await lstatIfPresent(stagingRoot);
	const quarantineRoot = path.join(lockPath, journal.stagingQuarantine);
	const quarantineDetails = await lstatIfPresent(quarantineRoot);
	if (stagingDetails && quarantineDetails) {
		return fail(
			"SKILLS_INSTALL_RECOVERY_REQUIRED",
			"Codex Skill staging cleanup contains ambiguous paths.",
		);
	}
	const ownedStagingRoot = stagingDetails
		? stagingRoot
		: quarantineDetails
			? quarantineRoot
			: undefined;
	if (ownedStagingRoot) {
		if (!ownership) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				"Codex Skill staging ownership evidence is missing.",
			);
		}
		await verifyOwnedStagingDirectory(
			skillsRoot,
			lockPath,
			ownedStagingRoot,
			journal,
			ownership,
			skills,
		);
	} else if (!ownership) {
		for (const skill of skills) {
			if (await lstatIfPresent(path.join(skillsRoot, skill.name))) {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"An interrupted Codex Skill installation requires manual inspection.",
				);
			}
		}
		await cleanupTransaction(
			authorityRoot,
			agentsRoot,
			skillsRoot,
			lockPath,
			stagingRoot,
			identity,
			journal,
			skills,
			beforeStagingDetach,
			beforeQuarantineCleanup,
		);
		return false;
	}
	const ownedTargets: OwnedSkillTarget[] = [];
	for (const skill of skills) {
		const destination = path.join(skillsRoot, skill.name);
		const destinationDetails = await lstatIfPresent(destination);
		if (destinationDetails) {
			if (
				destinationDetails.isSymbolicLink() ||
				!destinationDetails.isDirectory()
			) {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"An interrupted Codex Skill installation requires manual inspection.",
				);
			}
			const markerDetails = await lstatIfPresent(
				path.join(destination, targetOwnerMarkerName),
			);
			const target = await captureOwnedSkillTarget(
				destination,
				skill,
				markerDetails !== undefined,
			);
			try {
				if (markerDetails) {
					if (markerDetails.isSymbolicLink() || !markerDetails.isFile()) {
						throw new Error("invalid owner marker");
					}
					await verifyRemovableSkillTarget(destination, target, journal.nonce);
				} else {
					await verifyInstalledSkill(destination, skill);
					await assertOwnedSkillTarget(
						destination,
						target,
						"SKILLS_INSTALL_RECOVERY_REQUIRED",
					);
				}
			} catch {
				return fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"An interrupted Codex Skill installation requires manual inspection.",
				);
			}
			ownedTargets.push(target);
		}
	}
	const installationComplete =
		ownedTargets.length === skills.length &&
		ownedTargets.every((target) => !target.markerPresent);
	if (!installationComplete) {
		for (const target of [...ownedTargets].reverse()) {
			const destination = path.join(skillsRoot, target.skill.name);
			await assertDestinationStable(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
				identity,
			);
			await verifyRemovableSkillTarget(destination, target, journal.nonce);
			await rm(destination, { recursive: true, force: false });
			await assertDestinationStable(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
				identity,
			);
		}
	}
	await assertDestinationStable(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		identity,
	);
	await cleanupTransaction(
		authorityRoot,
		agentsRoot,
		skillsRoot,
		lockPath,
		stagingRoot,
		identity,
		journal,
		skills,
		beforeStagingDetach,
		beforeQuarantineCleanup,
	);
	return installationComplete;
}

async function commitStagedSkills(
	skillsRoot: string,
	skills: VerifiedSkill[],
	nonce: string,
	write: typeof writeFile,
	remove: typeof rm,
	assertStable: () => Promise<void>,
	beforeTargetCommit?: SkillsInstallDependencies["beforeTargetCommit"],
	afterTargetCommit?: SkillsInstallDependencies["afterTargetCommit"],
	beforeTargetRollback?: SkillsInstallDependencies["beforeTargetRollback"],
) {
	const ownedTargets: OwnedSkillTarget[] = [];
	try {
		for (const [index, skill] of skills.entries()) {
			await assertStable();
			await beforeTargetCommit?.(skill.name, index);
			await assertStable();
			const destination = path.join(skillsRoot, skill.name);
			try {
				await mkdir(destination, { mode: 0o700 });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				return fail(
					"SKILLS_DESTINATION_CONFLICT",
					`Codex Skill destination already exists for: ${skill.name}. Inspect it manually; this installer never overwrites or merges.`,
				);
			}
			const target = await captureOwnedSkillTarget(destination, skill, false);
			ownedTargets.push(target);
			await materializeReservedSkill(destination, target, nonce, write);
			await afterTargetCommit?.(skill.name, index);
			await assertStable();
		}
	} catch (error) {
		const rollbackFailures: SupportedSkillName[] = [];
		for (const target of [...ownedTargets].reverse()) {
			try {
				await beforeTargetRollback?.(target.skill.name);
				await assertStable();
				const destination = path.join(skillsRoot, target.skill.name);
				await verifyRemovableSkillTarget(destination, target, nonce, true);
				await remove(destination, { recursive: true, force: false });
				await assertStable();
			} catch {
				rollbackFailures.push(target.skill.name);
			}
		}
		if (rollbackFailures.length > 0) {
			return fail(
				"SKILLS_INSTALL_RECOVERY_REQUIRED",
				`Codex Skill installation rollback requires manual inspection for: ${rollbackFailures.join(", ")}.`,
			);
		}
		throw error;
	}
}

function packagedAssetRoot(): string {
	return path.join(__dirname, "skills");
}

export function parseSkillsInstallRequest(
	action: unknown,
	options: Record<string, unknown>,
): SkillsInstallRequest {
	if (action !== "install") {
		return fail(
			"SKILLS_ACTION_UNSUPPORTED",
			"Only `openapi skills install --host codex --scope project|user` is supported.",
		);
	}
	const hosts = Array.isArray(options.host)
		? options.host
		: options.host === undefined
			? []
			: [options.host];
	if (hosts.length === 0) {
		return fail(
			"SKILLS_HOST_REQUIRED",
			"`--host codex` is required; only the Codex Host is supported.",
		);
	}
	if (hosts.length > 1) {
		return fail(
			"SKILLS_HOST_DUPLICATE",
			"`--host` must be specified exactly once; only the Codex Host is supported.",
		);
	}
	if (
		hosts[0] === true ||
		hosts[0] === false ||
		typeof hosts[0] !== "string" ||
		hosts[0].length === 0
	) {
		return fail(
			"SKILLS_HOST_EMPTY",
			"`--host` requires the value `codex`; only the Codex Host is supported.",
		);
	}
	if (hosts[0] !== "codex") {
		return fail(
			"SKILLS_HOST_UNSUPPORTED",
			`Unsupported Skill Host ${JSON.stringify(hosts[0])}; only the Codex Host is supported.`,
		);
	}
	const scopes = Array.isArray(options.scope)
		? options.scope
		: options.scope === undefined
			? []
			: [options.scope];
	if (scopes.length === 0) {
		return fail(
			"SKILLS_SCOPE_REQUIRED",
			"`--scope` is required; choose `--scope project` or `--scope user`.",
		);
	}
	if (scopes.length > 1) {
		return fail(
			"SKILLS_SCOPE_DUPLICATE",
			"`--scope` must be specified exactly once; choose `project` or `user`.",
		);
	}
	if (
		scopes[0] === true ||
		scopes[0] === false ||
		typeof scopes[0] !== "string" ||
		scopes[0].length === 0
	) {
		return fail(
			"SKILLS_SCOPE_EMPTY",
			"`--scope` requires the value `project` or `user`.",
		);
	}
	if (scopes[0] !== "project" && scopes[0] !== "user") {
		return fail(
			"SKILLS_SCOPE_UNSUPPORTED",
			`Unsupported Skill installation scope ${JSON.stringify(scopes[0])}; choose ` +
				"`project` or `user`.",
		);
	}
	return {
		dryRun: options.dryRun === true,
		json: options.json === true,
		scope: scopes[0],
	};
}

export async function installCodexSkills(
	request: SkillsInstallRequest,
	packageVersion: string,
	dependencies: SkillsInstallDependencies = {},
): Promise<SkillsInstallOutput> {
	try {
		const verifiedSkills = await verifyPackagedSkills(
			dependencies.assetRoot ?? packagedAssetRoot(),
			packageVersion,
		);
		const homeDirectory = dependencies.homeDirectory ?? homedir;
		const destination = resolveSkillDestination(
			request.scope,
			homeDirectory,
			dependencies.workingDirectory ?? process.cwd,
		);
		const { authorityRoot, agentsRoot, skillsRoot } = destination;
		const warnings =
			dependencies.detectLegacyInstallation === false
				? []
				: await detectLegacyInstallation(homeDirectory);
		await preflightDestination(authorityRoot, agentsRoot, skillsRoot, {
			checkConflicts: false,
			checkLock: false,
		});
		const recoveredComplete =
			!request.dryRun &&
			(await recoverInterruptedInstallation(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				packageVersion,
				verifiedSkills,
				dependencies.beforeStagingDetach,
				dependencies.beforeQuarantineCleanup,
			));
		const output: SkillsInstallOutput = {
			success: true,
			command: "skills install",
			mode: request.dryRun ? "dry-run" : "install",
			host: "codex",
			scope: request.scope,
			packageVersion,
			source: "packaged-npm-assets",
			destinationRoot: skillsRoot,
			skills: [...supportedSkillNames],
			actions: supportedSkillNames.map((skill) => ({
				action: "install",
				skill,
				destination: path.join(skillsRoot, skill),
			})),
			installed: request.dryRun ? [] : [...supportedSkillNames],
			restartRequired: true,
			warnings,
		};
		if (recoveredComplete) return output;
		const initialState = await preflightDestination(
			authorityRoot,
			agentsRoot,
			skillsRoot,
		);
		if (request.dryRun) return output;

		let lockAcquired = false;
		let journalWritten = false;
		let preserveTransaction = false;
		let identity: DestinationIdentity | undefined;
		let journal: InstallJournal | undefined;
		let installed = false;
		const nonce = validateTransactionNonce(
			(dependencies.transactionNonce ?? randomUUID)(),
		);
		const lockPath = path.join(skillsRoot, installLockName);
		const stagingRoot = path.join(
			skillsRoot,
			`${stagingDirectoryPrefix}${nonce}`,
		);
		try {
			await ensureDestinationDirectories(agentsRoot, skillsRoot);
			const createdAuthorityRoot = await lstat(authorityRoot);
			const createdAgentsRoot = await lstat(agentsRoot);
			const createdSkillsRoot = await lstat(skillsRoot);
			if (
				createdAuthorityRoot.isSymbolicLink() ||
				!createdAuthorityRoot.isDirectory() ||
				createdAgentsRoot.isSymbolicLink() ||
				!createdAgentsRoot.isDirectory() ||
				createdSkillsRoot.isSymbolicLink() ||
				!createdSkillsRoot.isDirectory()
			) {
				return fail(
					"SKILLS_DESTINATION_INVALID",
					"The Codex Skill destination changed during installation.",
				);
			}
			try {
				await mkdir(lockPath, { mode: 0o700 });
				lockAcquired = true;
			} catch {
				return fail(
					"SKILLS_INSTALL_BUSY",
					"A Codex Skill installation is already active or requires manual inspection.",
				);
			}
			identity = await captureDestinationIdentity(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
			);
			activeTransactionNonces.add(nonce);
			journal = {
				schemaVersion: 2,
				packageVersion,
				pid: dependencies.processId ?? process.pid,
				nonce,
				stagingDirectory: path.basename(stagingRoot),
				stagingOwnerRecord: stagingOwnerRecordName,
				stagingOwnerMarker: stagingOwnerMarkerName,
				stagingQuarantine: stagingQuarantineName,
				skills: [...supportedSkillNames],
			};
			await writeInstallJournal(lockPath, journal);
			journalWritten = true;
			await assertDestinationStable(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
				identity,
			);
			const lockedState = await preflightDestination(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				{
					checkLock: false,
				},
			);
			if (!lockedState.skillsRootPresent) {
				return fail(
					"SKILLS_DESTINATION_INVALID",
					"The Codex Skill destination changed during installation.",
				);
			}
			await dependencies.beforeStaging?.();
			await assertDestinationStable(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
				identity,
			);
			await mkdir(stagingRoot, { mode: 0o700 });
			await createStagingOwnership(lockPath, stagingRoot, nonce);
			await assertDestinationStable(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
				identity,
			);
			const fileWriter = dependencies.writeFile ?? writeFile;
			await writeStagedSkills(stagingRoot, verifiedSkills, fileWriter);
			await assertDestinationStable(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
				identity,
			);
			for (const skill of verifiedSkills) {
				await verifyInstalledSkill(path.join(stagingRoot, skill.name), skill);
			}
			await assertDestinationStable(
				authorityRoot,
				agentsRoot,
				skillsRoot,
				lockPath,
				identity,
			);
			await commitStagedSkills(
				skillsRoot,
				verifiedSkills,
				nonce,
				fileWriter,
				dependencies.remove ?? rm,
				() =>
					assertDestinationStable(
						authorityRoot,
						agentsRoot,
						skillsRoot,
						lockPath,
						identity as DestinationIdentity,
					),
				dependencies.beforeTargetCommit,
				dependencies.afterTargetCommit,
				dependencies.beforeTargetRollback,
			);
			installed = true;
		} catch (error) {
			if (
				error instanceof SkillsInstallError &&
				[
					"SKILLS_DESTINATION_CHANGED",
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
				].includes(error.code)
			) {
				preserveTransaction = true;
			}
			throw error;
		} finally {
			activeTransactionNonces.delete(nonce);
			const cleanupSafe =
				!identity ||
				(await destinationIsStable(
					authorityRoot,
					agentsRoot,
					skillsRoot,
					lockPath,
					identity,
				));
			if (lockAcquired && !preserveTransaction && !cleanupSafe) {
				fail(
					"SKILLS_INSTALL_RECOVERY_REQUIRED",
					"Codex Skill installation cleanup requires manual inspection.",
				);
			}
			if (lockAcquired && !preserveTransaction && cleanupSafe) {
				if (journalWritten && journal && identity) {
					await cleanupTransaction(
						authorityRoot,
						agentsRoot,
						skillsRoot,
						lockPath,
						stagingRoot,
						identity,
						journal,
						verifiedSkills,
						dependencies.beforeStagingDetach,
						dependencies.beforeQuarantineCleanup,
					);
				} else {
					await rmdir(lockPath);
				}
			}
			if (
				!installed &&
				!preserveTransaction &&
				cleanupSafe &&
				!initialState.skillsRootPresent
			) {
				await rmdir(skillsRoot).catch(() => undefined);
			}
			if (
				!installed &&
				!preserveTransaction &&
				cleanupSafe &&
				!initialState.agentsRootPresent
			) {
				await rmdir(agentsRoot).catch(() => undefined);
			}
			if (
				!installed &&
				!preserveTransaction &&
				cleanupSafe &&
				!initialState.authorityRootPresent
			) {
				await rmdir(authorityRoot).catch(() => undefined);
			}
		}
		return output;
	} catch (error) {
		if (error instanceof SkillsInstallError) throw error;
		throw new SkillsInstallError(
			"SKILLS_INSTALL_FAILED",
			"Codex Skill installation failed safely; no overwrite was attempted.",
		);
	}
}

export function skillsInstallHumanOutput(
	output: SkillsInstallOutput,
): string[] {
	const lines = [
		`Scope: ${output.scope}`,
		`Destination: ${output.destinationRoot}`,
		"Skills:",
		...output.skills.map((name) => `- ${name}`),
		"Actions:",
		...output.actions.map(
			({ action, skill, destination }) =>
				`- ${action} ${skill} -> ${destination}`,
		),
		...output.warnings.map((warning) => `Warning: ${warning}`),
	];
	if (output.mode === "dry-run") {
		return [
			"Agent Skill install plan (dry run)",
			`Package version: ${output.packageVersion}`,
			"Source: packaged npm assets (offline)",
			...lines,
			"No files were written.",
			"Start a new Codex chat/session after applying this plan.",
			"If the Skills are still unavailable, restart Codex and check again.",
		];
	}
	return [
		"Installed Agent Skills:",
		...lines,
		`Installed: ${output.installed.join(", ")}`,
		"restartRequired: true",
		"Start a new Codex chat/session to load the installed Skills.",
		"If they remain unavailable, restart Codex and check again.",
	];
}
