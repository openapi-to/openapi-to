import { createHash } from 'node:crypto';
import { posix as path } from 'node:path';
import { INTAKE_SCHEMA_VERSION, INTAKE_STATUS, LIMITS, REASON } from './model.mjs';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value, keys) => isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
const bytes = (value) => Buffer.byteLength(value, 'utf8');
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const isSha256 = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const isIsoUtc = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
};

function contractDigest(issue) {
  return sha256(JSON.stringify([issue.title, issue.body]));
}

export function canonicalPolicyDigest(policy) {
  const canonical = {
    version: policy.version,
    validFrom: policy.validFrom,
    validUntil: policy.validUntil,
    repository: { name: policy.repository.name, numericId: policy.repository.numericId },
    maximumWip: policy.maximumWip,
    allowedModes: [...policy.allowedModes].sort(),
    allowedPathPrefixes: [...policy.allowedPathPrefixes].sort(),
    fixtureOnly: policy.fixtureOnly,
  };
  return sha256(JSON.stringify(canonical));
}

function failure(status, reasons, evidence = {}) {
  const reasonCodes = [...new Set(reasons)].sort();
  return {
    schemaVersion: INTAKE_SCHEMA_VERSION,
    status,
    shadow: true,
    wouldSpawn: status === INTAKE_STATUS.ELIGIBLE,
    spawnAuthorized: false,
    reasonCodes,
    evidence: {
      issueId: Number.isSafeInteger(evidence.issueId) ? evidence.issueId : null,
      repositoryId: Number.isSafeInteger(evidence.repositoryId) ? evidence.repositoryId : null,
      policyVersion: typeof evidence.policyVersion === 'string' ? evidence.policyVersion : null,
      contractDigest: isSha256(evidence.contractDigest) ? evidence.contractDigest : null,
      adapterState: evidence.adapterState === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
    },
  };
}

function validPathProof(proof) {
  return (
    isRecord(proof) &&
    hasOnlyKeys(proof, ['path', 'withinOwnedSurface', 'symlinkFree']) &&
    typeof proof.path === 'string' &&
    bytes(proof.path) <= LIMITS.pathBytes &&
    !proof.path.startsWith('/') &&
    !proof.path.includes('\\') &&
    !proof.path.includes(':') &&
    !proof.path.split('/').some((part) => part === '' || part === '.' || part === '..') &&
    path.normalize(proof.path) === proof.path &&
    proof.withinOwnedSurface === true &&
    proof.symlinkFree === true
  );
}

function validPathPrefix(prefix) {
  if (typeof prefix !== 'string' || bytes(prefix) === 0 || bytes(prefix) > LIMITS.pathBytes) return false;
  if (prefix.startsWith('/') || prefix.includes('\\') || prefix.includes(':')) return false;
  const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return normalizedPrefix.length > 0 &&
    !normalizedPrefix.split('/').some((part) => part === '' || part === '.' || part === '..') &&
    path.normalize(normalizedPrefix) === normalizedPrefix;
}

function pathMatchesPrefix(itemPath, prefix) {
  return prefix.endsWith('/') ? itemPath.startsWith(prefix) : itemPath === prefix;
}

function schemaValid(snapshot, policy) {
  if (!hasOnlyKeys(snapshot, [
    'schemaVersion', 'evaluationTime', 'issue', 'receipt', 'facts', 'hostCapabilities', 'adapterState', 'fixtureOnly',
  ])) return false;
  if (!hasOnlyKeys(policy, [
    'version', 'sha256', 'validFrom', 'validUntil', 'repository', 'maximumWip', 'allowedModes', 'allowedPathPrefixes', 'fixtureOnly',
  ])) return false;
  if (!hasOnlyKeys(snapshot.issue, [
    'repository', 'id', 'state', 'title', 'body', 'labels', 'assignees',
  ])) return false;
  if (!hasOnlyKeys(snapshot.issue?.repository, ['name', 'numericId'])) return false;
  if (!hasOnlyKeys(snapshot.receipt, [
    'kind', 'verifier', 'repositoryId', 'issueId', 'actorVerified', 'mode', 'contractDigest', 'policyVersion',
    'policySha256', 'issuedAt', 'expiresAt', 'revoked', 'nonce',
  ])) return false;
  if (!hasOnlyKeys(snapshot.facts, [
    'risk', 'writeSurface', 'paths', 'nativeBlockers', 'dependencies', 'wip', 'duplicates', 'main', 'replayedNonces',
  ])) return false;
  if (!hasOnlyKeys(snapshot.facts?.wip, ['active', 'maximum'])) return false;
  if (!hasOnlyKeys(snapshot.facts?.duplicates, ['sessions', 'branches', 'pullRequests'])) return false;
  if (!hasOnlyKeys(snapshot.facts?.main, ['expectedSha', 'observedSha'])) return false;
  if (!hasOnlyKeys(snapshot.hostCapabilities, ['ao', 'github', 'shell'])) return false;

  const issue = snapshot.issue;
  return (
    snapshot.schemaVersion === INTAKE_SCHEMA_VERSION &&
    isIsoUtc(snapshot.evaluationTime) &&
    Number.isSafeInteger(issue?.id) && issue.id > 0 &&
    typeof issue?.state === 'string' &&
    typeof issue?.title === 'string' && bytes(issue.title) <= LIMITS.titleBytes &&
    typeof issue?.body === 'string' && bytes(issue.body) <= LIMITS.bodyBytes &&
    Array.isArray(issue?.labels) && issue.labels.length <= LIMITS.collectionItems && issue.labels.every((label) => typeof label === 'string' && bytes(label) <= 128) &&
    Array.isArray(issue?.assignees) && issue.assignees.length <= LIMITS.collectionItems && issue.assignees.every((assignee) => typeof assignee === 'string' && bytes(assignee) <= 128) &&
    typeof issue?.repository?.name === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(issue.repository.name) &&
    !issue.repository.name.split('/').some((part) => part === '.' || part === '..') && bytes(issue.repository.name) <= 200 &&
    Number.isSafeInteger(issue.repository.numericId) && issue.repository.numericId > 0 &&
    typeof snapshot.fixtureOnly === 'boolean' &&
    Number.isSafeInteger(policy.maximumWip) && policy.maximumWip > 0 && policy.maximumWip <= 100_000 &&
    typeof policy.version === 'string' && bytes(policy.version) <= 64 &&
    isSha256(policy.sha256) && isIsoUtc(policy.validFrom) && isIsoUtc(policy.validUntil) &&
    hasOnlyKeys(policy.repository, ['name', 'numericId']) &&
    typeof policy.repository.name === 'string' &&
    Number.isSafeInteger(policy.repository.numericId) && policy.repository.numericId > 0 &&
    Array.isArray(policy.allowedModes) && policy.allowedModes.length > 0 && policy.allowedModes.every((mode) => ['MANUAL', 'DESIGN_APPROVED', 'AUTONOMOUS'].includes(mode)) &&
    new Set(policy.allowedModes).size === policy.allowedModes.length &&
    Array.isArray(policy.allowedPathPrefixes) && policy.allowedPathPrefixes.length > 0 && policy.allowedPathPrefixes.length <= LIMITS.collectionItems &&
    policy.allowedPathPrefixes.every(validPathPrefix) &&
    new Set(policy.allowedPathPrefixes).size === policy.allowedPathPrefixes.length &&
    typeof policy.fixtureOnly === 'boolean' &&
    (snapshot.adapterState === 'VERIFIED' || snapshot.adapterState === 'UNVERIFIED') &&
    ['ao', 'github', 'shell'].every((key) => ['VERIFIED', 'UNVERIFIED'].includes(snapshot.hostCapabilities?.[key])) &&
    ['LOW', 'MEDIUM', 'HIGH', 'ROOT_OF_TRUST', 'UNKNOWN'].includes(snapshot.facts?.risk) &&
    ['LOW_RISK_DOCS_ONLY', 'CONTROLLED_CODE', 'ROOT_OF_TRUST', 'UNKNOWN'].includes(snapshot.facts?.writeSurface) &&
    Array.isArray(snapshot.facts?.paths) && snapshot.facts.paths.length <= LIMITS.collectionItems &&
    snapshot.facts.paths.every(validPathProof) &&
    Array.isArray(snapshot.facts?.nativeBlockers) && snapshot.facts.nativeBlockers.length <= LIMITS.collectionItems &&
    snapshot.facts.nativeBlockers.every((item) => typeof item === 'string' && bytes(item) <= 64) &&
    Array.isArray(snapshot.facts?.dependencies) && snapshot.facts.dependencies.length <= LIMITS.collectionItems &&
    snapshot.facts.dependencies.every((item) => hasOnlyKeys(item, ['id', 'satisfied']) && typeof item.id === 'string' && bytes(item.id) <= 64 && typeof item.satisfied === 'boolean') &&
    Number.isSafeInteger(snapshot.facts?.wip?.active) && snapshot.facts.wip.active >= 0 && snapshot.facts.wip.active <= 100_000 &&
    Number.isSafeInteger(snapshot.facts.wip.maximum) && snapshot.facts.wip.maximum > 0 && snapshot.facts.wip.maximum <= 100_000 &&
    ['sessions', 'branches', 'pullRequests'].every((key) =>
      Array.isArray(snapshot.facts.duplicates[key]) &&
      snapshot.facts.duplicates[key].length <= LIMITS.collectionItems &&
      snapshot.facts.duplicates[key].every((item) => typeof item === 'string' && bytes(item) <= 128) &&
      new Set(snapshot.facts.duplicates[key]).size === snapshot.facts.duplicates[key].length
    ) &&
    ['expectedSha', 'observedSha'].every((key) => isSha256(snapshot.facts.main?.[key])) &&
    Array.isArray(snapshot.facts.replayedNonces) && snapshot.facts.replayedNonces.length <= LIMITS.collectionItems &&
    snapshot.facts.replayedNonces.every((nonce) => typeof nonce === 'string' && bytes(nonce) <= 64) &&
    typeof snapshot.receipt?.kind === 'string' && bytes(snapshot.receipt.kind) <= 64 && typeof snapshot.receipt?.verifier === 'string' && bytes(snapshot.receipt.verifier) <= 64 &&
    Number.isSafeInteger(snapshot.receipt?.repositoryId) && Number.isSafeInteger(snapshot.receipt?.issueId) &&
    typeof snapshot.receipt?.actorVerified === 'boolean' && ['MANUAL', 'DESIGN_APPROVED', 'AUTONOMOUS'].includes(snapshot.receipt?.mode) &&
    isSha256(snapshot.receipt?.contractDigest) && typeof snapshot.receipt?.policyVersion === 'string' && bytes(snapshot.receipt.policyVersion) <= 64 &&
    isSha256(snapshot.receipt?.policySha256) && isIsoUtc(snapshot.receipt?.issuedAt) && isIsoUtc(snapshot.receipt?.expiresAt) &&
    typeof snapshot.receipt?.revoked === 'boolean' && typeof snapshot.receipt?.nonce === 'string' &&
    /^[a-zA-Z0-9_-]{8,64}$/.test(snapshot.receipt.nonce) && snapshot.receipt.issuedAt <= snapshot.receipt.expiresAt && policy.validFrom <= policy.validUntil &&
    new Set(snapshot.facts.paths.map(({ path: itemPath }) => itemPath)).size === snapshot.facts.paths.length &&
    new Set(snapshot.facts.dependencies.map(({ id }) => id)).size === snapshot.facts.dependencies.length &&
    new Set(snapshot.facts.replayedNonces).size === snapshot.facts.replayedNonces.length &&
    new Set(snapshot.facts.nativeBlockers).size === snapshot.facts.nativeBlockers.length &&
    new Set(issue.labels).size === issue.labels.length &&
    new Set(issue.assignees).size === issue.assignees.length &&
    snapshot.facts.paths.every(({ path: itemPath }) => policy.allowedPathPrefixes.some((prefix) => pathMatchesPrefix(itemPath, prefix)))
  );
}

/**
 * Pure Shadow evaluator. The fixture marker documents test provenance; it is
 * deliberately not a verifier and must never be accepted as production trust.
 */
export function evaluateIntake(snapshot, policy) {
  if (isRecord(snapshot) && snapshot.schemaVersion !== INTAKE_SCHEMA_VERSION) {
    return failure(INTAKE_STATUS.BLOCKED, [REASON.SCHEMA_VERSION_UNSUPPORTED]);
  }
  if (!schemaValid(snapshot, policy)) return failure(INTAKE_STATUS.BLOCKED, [REASON.INVALID_INPUT]);

  const issue = snapshot.issue;
  const receipt = snapshot.receipt;
  const facts = snapshot.facts;
  const reasons = [];
  const evidence = {
    issueId: issue.id,
    repositoryId: issue.repository.numericId,
    policyVersion: policy.version,
    contractDigest: contractDigest(issue),
    adapterState: snapshot.adapterState,
  };

  if (snapshot.evaluationTime < policy.validFrom || snapshot.evaluationTime > policy.validUntil) reasons.push(REASON.POLICY_EXPIRED);
  if (canonicalPolicyDigest(policy) !== policy.sha256) reasons.push(REASON.POLICY_SHA_MISMATCH);
  if (issue.repository.name !== policy.repository.name || issue.repository.numericId !== policy.repository.numericId) reasons.push(REASON.REPOSITORY_MISMATCH);
  if (issue.id !== receipt.issueId || issue.repository.numericId !== receipt.repositoryId) reasons.push(REASON.ISSUE_ID_MISMATCH);
  if (issue.state !== 'OPEN') reasons.push(REASON.ISSUE_NOT_OPEN);
  if (!snapshot.fixtureOnly || !policy.fixtureOnly || receipt.kind !== 'mock-verified-receipt' || receipt.verifier !== 'fixture-v1') reasons.push(REASON.RECEIPT_UNVERIFIED);
  if (receipt.actorVerified !== true) reasons.push(REASON.ACTOR_UNVERIFIED);
  if (receipt.issuedAt > snapshot.evaluationTime || receipt.expiresAt < snapshot.evaluationTime) reasons.push(REASON.RECEIPT_EXPIRED);
  if (receipt.revoked) reasons.push(REASON.RECEIPT_REVOKED);
  if (facts.replayedNonces.includes(receipt.nonce)) reasons.push(REASON.RECEIPT_REPLAYED);
  if (receipt.contractDigest !== contractDigest(issue)) reasons.push(REASON.CONTRACT_DIGEST_MISMATCH);
  if (receipt.policyVersion !== policy.version || receipt.policySha256 !== policy.sha256) reasons.push(REASON.POLICY_BINDING_MISMATCH);
  if (!policy.allowedModes.includes(receipt.mode) || receipt.mode !== 'AUTONOMOUS') reasons.push(REASON.MODE_NOT_AUTHORIZED);
  if (snapshot.adapterState !== 'VERIFIED' || Object.values(snapshot.hostCapabilities).some((state) => state !== 'VERIFIED')) reasons.push(REASON.HOST_CAPABILITY_UNVERIFIED);
  if (facts.nativeBlockers.length > 0) reasons.push(REASON.NATIVE_BLOCKER_PRESENT);
  if (facts.dependencies.some(({ satisfied }) => !satisfied)) reasons.push(REASON.DEPENDENCY_UNSATISFIED);
  if (facts.wip.active >= Math.min(facts.wip.maximum, policy.maximumWip)) reasons.push(REASON.WIP_LIMIT_REACHED);
  if (['sessions', 'branches', 'pullRequests'].some((key) => facts.duplicates[key].length > 0)) reasons.push(REASON.DUPLICATE_EXECUTION_PRESENT);
  if (facts.main.expectedSha !== facts.main.observedSha) reasons.push(REASON.MAIN_SHA_DRIFT);
  if (facts.risk !== 'LOW') reasons.push(REASON.HIGH_OR_UNKNOWN_RISK);
  if (facts.writeSurface !== 'LOW_RISK_DOCS_ONLY') reasons.push(REASON.WRITE_SURFACE_UNKNOWN);
  if (facts.paths.length === 0 || !facts.paths.every(validPathProof)) reasons.push(REASON.PATH_PROOF_INVALID);
  if (facts.risk === 'ROOT_OF_TRUST' || facts.risk === 'HIGH' || facts.writeSurface === 'ROOT_OF_TRUST') reasons.push(REASON.HIGH_RISK_REQUIRES_HUMAN);

  const humanReviewReasons = new Set([
    REASON.MODE_NOT_AUTHORIZED,
    REASON.HIGH_OR_UNKNOWN_RISK,
    REASON.WRITE_SURFACE_UNKNOWN,
    REASON.HIGH_RISK_REQUIRES_HUMAN,
  ]);
  const hasBlockingReason = reasons.some((reason) => !humanReviewReasons.has(reason));
  let status = INTAKE_STATUS.ELIGIBLE;
  if (hasBlockingReason) status = INTAKE_STATUS.BLOCKED;
  else if (reasons.length > 0) status = INTAKE_STATUS.HUMAN;
  return failure(status, reasons, evidence);
}
