import { createHash } from 'node:crypto';
import { posix as path } from 'node:path';
import { DECISION, LIMITS, POLICY_SCHEMA_VERSION, REASON } from './model.mjs';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key));
const byteLength = (value) => Buffer.byteLength(value, 'utf8');
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const isDigest = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const isSafeId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const isUtc = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
};
const stableJson = (value) => JSON.stringify(stableValue(value));

export function canonicalPolicyDigest(policy) {
  const { policySha256: _ignored, provenance: _provenance, ...material } = policy;
  return sha256(stableJson(material));
}

export function canonicalContractDigest(contract) {
  return sha256(stableJson(contract));
}

export function canonicalSnapshotDigest(snapshot) {
  const { digest: _ignored, ...evidence } = snapshot.evidence;
  return sha256(stableJson({ ...snapshot, evidence }));
}

const safeOutput = (decision, reasons, snapshot, policy) => {
  const sortedReasons = [...new Set(reasons)].sort();
  const output = {
    schemaVersion: POLICY_SCHEMA_VERSION,
    policyVersion: isSafeId(policy?.version) ? policy.version : null,
    decision,
    shadowOnly: true,
    enqueueAuthorized: false,
    reasonCodes: sortedReasons,
    binding: {
      repositoryId: Number.isSafeInteger(snapshot?.task?.repositoryId) ? snapshot.task.repositoryId : null,
      issueId: Number.isSafeInteger(snapshot?.task?.issueId) ? snapshot.task.issueId : null,
      contractDigest: isDigest(snapshot?.task?.contractDigest) ? snapshot.task.contractDigest : null,
      pullRequestId: Number.isSafeInteger(snapshot?.pullRequest?.id) ? snapshot.pullRequest.id : null,
      headSha: typeof snapshot?.pullRequest?.headSha === 'string' && /^[a-f0-9]{40}$/.test(snapshot.pullRequest.headSha) ? snapshot.pullRequest.headSha : null,
      mainSha: typeof snapshot?.main?.sha === 'string' && /^[a-f0-9]{40}$/.test(snapshot.main.sha) ? snapshot.main.sha : null,
      policySha256: isDigest(policy?.policySha256) ? policy.policySha256 : null,
    },
    evidence: {
      snapshotId: isSafeId(snapshot?.evidence?.snapshotId) ? snapshot.evidence.snapshotId : null,
      verification: snapshot?.evidence?.verification === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
      aoReviewRunId: isSafeId(snapshot?.review?.runId) ? snapshot.review.runId : null,
      githubReviewId: isSafeId(snapshot?.review?.githubReviewId) ? snapshot.review.githubReviewId : null,
      reviewHeadSha: typeof snapshot?.review?.headSha === 'string' && /^[a-f0-9]{40}$/.test(snapshot.review.headSha) ? snapshot.review.headSha : null,
      reviewState: ['APPROVED', 'CHANGES_REQUESTED', 'PENDING', 'MISSING'].includes(snapshot?.review?.state) ? snapshot.review.state : 'UNVERIFIED',
      ciRunId: isSafeId(snapshot?.ci?.runId) ? snapshot.ci.runId : null,
      ciHeadSha: typeof snapshot?.ci?.headSha === 'string' && /^[a-f0-9]{40}$/.test(snapshot.ci.headSha) ? snapshot.ci.headSha : null,
      ciState: ['PASS', 'FAIL', 'PENDING', 'MISSING'].includes(snapshot?.ci?.state) ? snapshot.ci.state : 'UNVERIFIED',
    },
  };
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > LIMITS.outputBytes) {
    return {
      schemaVersion: POLICY_SCHEMA_VERSION,
      policyVersion: null,
      decision: DECISION.BLOCKED,
      shadowOnly: true,
      enqueueAuthorized: false,
      reasonCodes: [REASON.INVALID_EVIDENCE],
      binding: { repositoryId: null, issueId: null, contractDigest: null, pullRequestId: null, headSha: null, mainSha: null, policySha256: null },
      evidence: { snapshotId: null, verification: 'UNVERIFIED', aoReviewRunId: null, githubReviewId: null, reviewHeadSha: null, reviewState: 'UNVERIFIED', ciRunId: null, ciHeadSha: null, ciState: 'UNVERIFIED' },
    };
  }
  return output;
};

function validPath(value) {
  return typeof value === 'string' && value.length > 0 && byteLength(value) <= LIMITS.pathBytes &&
    !value.includes('\0') && !value.includes('\\') && !value.includes(':') && !value.startsWith('/') &&
    path.normalize(value) === value && !value.split('/').some((part) => !part || part === '.' || part === '..');
}

function validPathProof(value) {
  return onlyKeys(value, ['path', 'withinRepository', 'symlinkFree', 'withinApprovedScope']) && validPath(value.path) &&
    typeof value.withinRepository === 'boolean' && typeof value.symlinkFree === 'boolean' && typeof value.withinApprovedScope === 'boolean';
}

function validPolicy(policy) {
  if (!onlyKeys(policy, ['schemaVersion', 'version', 'policySha256', 'validFrom', 'validUntil', 'repositoryId', 'trustedActorIds', 'maximumEvidenceAgeMs', 'maximumRepairRounds', 'maximumCiReruns', 'maximumWip', 'lowRiskDocPrefixes', 'rootOfTrustPaths', 'provenance'])) return false;
  return policy.schemaVersion === POLICY_SCHEMA_VERSION && isSafeId(policy.version) &&
    isDigest(policy.policySha256) && isUtc(policy.validFrom) && isUtc(policy.validUntil) && policy.validFrom <= policy.validUntil &&
    Number.isSafeInteger(policy.repositoryId) && policy.repositoryId > 0 && Array.isArray(policy.trustedActorIds) && policy.trustedActorIds.length > 0 && policy.trustedActorIds.length <= LIMITS.collectionItems && policy.trustedActorIds.every(isSafeId) && new Set(policy.trustedActorIds).size === policy.trustedActorIds.length &&
    Number.isSafeInteger(policy.maximumEvidenceAgeMs) && policy.maximumEvidenceAgeMs > 0 && policy.maximumEvidenceAgeMs <= 7 * 24 * 60 * 60 * 1000 &&
    Number.isSafeInteger(policy.maximumRepairRounds) && policy.maximumRepairRounds >= 0 && policy.maximumRepairRounds <= 10 &&
    Number.isSafeInteger(policy.maximumCiReruns) && policy.maximumCiReruns >= 0 && policy.maximumCiReruns <= 5 &&
    Number.isSafeInteger(policy.maximumWip) && policy.maximumWip > 0 && policy.maximumWip <= 10_000 &&
    Array.isArray(policy.lowRiskDocPrefixes) && policy.lowRiskDocPrefixes.length > 0 && policy.lowRiskDocPrefixes.length <= LIMITS.collectionItems && policy.lowRiskDocPrefixes.every((prefix) => validPath(prefix) && prefix.startsWith('docs/')) &&
    Array.isArray(policy.rootOfTrustPaths) && policy.rootOfTrustPaths.length > 0 && policy.rootOfTrustPaths.length <= LIMITS.collectionItems && policy.rootOfTrustPaths.every(validPath) &&
    new Set(policy.lowRiskDocPrefixes).size === policy.lowRiskDocPrefixes.length && new Set(policy.rootOfTrustPaths).size === policy.rootOfTrustPaths.length &&
    onlyKeys(policy.provenance, ['state', 'authority', 'policySha256']) && policy.provenance.state === 'VERIFIED' && policy.provenance.authority === 'TRUSTED_POLICY_SOURCE' && policy.provenance.policySha256 === policy.policySha256 &&
    canonicalPolicyDigest(policy) === policy.policySha256;
}

function validSnapshot(snapshot) {
  if (!onlyKeys(snapshot, ['schemaVersion', 'evaluatedAt', 'task', 'pullRequest', 'main', 'actor', 'review', 'ci', 'dependencies', 'wip', 'duplicates', 'budgets', 'evidence'])) return false;
  if (snapshot.schemaVersion !== POLICY_SCHEMA_VERSION || !isUtc(snapshot.evaluatedAt)) return false;
  if (!onlyKeys(snapshot.task, ['repositoryId', 'issueId', 'contractDigest', 'approvedContractDigest', 'risk', 'riskEvidence']) ||
      !onlyKeys(snapshot.pullRequest, ['id', 'repositoryId', 'taskIssueId', 'state', 'baseBranch', 'baseSha', 'headSha', 'authorId', 'changedPaths', 'pathSetComplete', 'untrackedFilesVerified']) ||
      !onlyKeys(snapshot.main, ['sha', 'observedAt', 'verification']) ||
      !onlyKeys(snapshot.actor, ['id', 'verification', 'provenance']) ||
      !onlyKeys(snapshot.review, ['state', 'runState', 'producer', 'runId', 'observedAt', 'pullRequestId', 'headSha', 'reviewerId', 'authorId', 'implementerId', 'provenance', 'githubReviewId', 'feedbackDelivered', 'openP0', 'openP1']) ||
      !onlyKeys(snapshot.ci, ['state', 'source', 'runId', 'observedAt', 'pullRequestId', 'headSha', 'requiredChecksComplete', 'provenance']) ||
      !onlyKeys(snapshot.dependencies, ['verification', 'allSatisfied', 'ids']) || !onlyKeys(snapshot.wip, ['verification', 'active', 'maximum']) ||
      !onlyKeys(snapshot.duplicates, ['verification', 'candidateIds']) || !onlyKeys(snapshot.budgets, ['repairRounds', 'ciReruns']) ||
      !onlyKeys(snapshot.evidence, ['snapshotId', 'observedAt', 'verification', 'provenance', 'replayStatus', 'policyVersion', 'policySha256', 'digest'])) return false;

  const strings = [snapshot.actor.id, snapshot.pullRequest.authorId, snapshot.review.reviewerId, snapshot.review.authorId, snapshot.review.implementerId];
  return Number.isSafeInteger(snapshot.task.repositoryId) && snapshot.task.repositoryId > 0 && Number.isSafeInteger(snapshot.task.issueId) && snapshot.task.issueId > 0 && isDigest(snapshot.task.contractDigest) && isDigest(snapshot.task.approvedContractDigest) &&
    ['LOW', 'MEDIUM', 'HIGH', 'ROOT_OF_TRUST', 'UNKNOWN'].includes(snapshot.task.risk) && snapshot.task.riskEvidence === 'VERIFIED' &&
    Number.isSafeInteger(snapshot.pullRequest.id) && snapshot.pullRequest.id > 0 && Number.isSafeInteger(snapshot.pullRequest.repositoryId) && Number.isSafeInteger(snapshot.pullRequest.taskIssueId) && snapshot.pullRequest.state === 'OPEN' && snapshot.pullRequest.baseBranch === 'main' && /^[a-f0-9]{40}$/.test(snapshot.pullRequest.baseSha) && /^[a-f0-9]{40}$/.test(snapshot.pullRequest.headSha) &&
    Array.isArray(snapshot.pullRequest.changedPaths) && snapshot.pullRequest.changedPaths.length > 0 && snapshot.pullRequest.changedPaths.length <= LIMITS.collectionItems && snapshot.pullRequest.changedPaths.every(validPathProof) && new Set(snapshot.pullRequest.changedPaths.map(({ path: changedPath }) => changedPath)).size === snapshot.pullRequest.changedPaths.length && typeof snapshot.pullRequest.pathSetComplete === 'boolean' && typeof snapshot.pullRequest.untrackedFilesVerified === 'boolean' &&
    /^[a-f0-9]{40}$/.test(snapshot.main.sha) && isUtc(snapshot.main.observedAt) && ['VERIFIED', 'UNVERIFIED'].includes(snapshot.main.verification) &&
    strings.every(isSafeId) && ['VERIFIED', 'UNVERIFIED'].includes(snapshot.actor.verification) && ['TRUSTED_ACTOR_PROVENANCE', 'UNVERIFIED'].includes(snapshot.actor.provenance) &&
    ['APPROVED', 'CHANGES_REQUESTED', 'PENDING', 'MISSING'].includes(snapshot.review.state) && ['COMPLETED', 'IN_PROGRESS', 'FAILED', 'MISSING'].includes(snapshot.review.runState) && isSafeId(snapshot.review.producer) && isSafeId(snapshot.review.runId) && isUtc(snapshot.review.observedAt) && Number.isSafeInteger(snapshot.review.pullRequestId) && /^[a-f0-9]{40}$/.test(snapshot.review.headSha) && snapshot.review.provenance === 'VERIFIED_AO_NATIVE_REVIEW' && isSafeId(snapshot.review.githubReviewId) && typeof snapshot.review.feedbackDelivered === 'boolean' && Number.isSafeInteger(snapshot.review.openP0) && snapshot.review.openP0 >= 0 && Number.isSafeInteger(snapshot.review.openP1) && snapshot.review.openP1 >= 0 &&
    ['PASS', 'FAIL', 'PENDING', 'MISSING'].includes(snapshot.ci.state) && snapshot.ci.source === 'GITHUB_ACTIONS' && isSafeId(snapshot.ci.runId) && isUtc(snapshot.ci.observedAt) && Number.isSafeInteger(snapshot.ci.pullRequestId) && /^[a-f0-9]{40}$/.test(snapshot.ci.headSha) && typeof snapshot.ci.requiredChecksComplete === 'boolean' && ['VERIFIED', 'UNVERIFIED'].includes(snapshot.ci.provenance) &&
    ['VERIFIED', 'UNVERIFIED'].includes(snapshot.dependencies.verification) && typeof snapshot.dependencies.allSatisfied === 'boolean' && Array.isArray(snapshot.dependencies.ids) && snapshot.dependencies.ids.length <= LIMITS.collectionItems && snapshot.dependencies.ids.every(isSafeId) && new Set(snapshot.dependencies.ids).size === snapshot.dependencies.ids.length &&
    ['VERIFIED', 'UNVERIFIED'].includes(snapshot.wip.verification) && Number.isSafeInteger(snapshot.wip.active) && snapshot.wip.active >= 0 && Number.isSafeInteger(snapshot.wip.maximum) && snapshot.wip.maximum > 0 &&
    ['VERIFIED', 'UNVERIFIED'].includes(snapshot.duplicates.verification) && Array.isArray(snapshot.duplicates.candidateIds) && snapshot.duplicates.candidateIds.length <= LIMITS.collectionItems && snapshot.duplicates.candidateIds.every(isSafeId) && new Set(snapshot.duplicates.candidateIds).size === snapshot.duplicates.candidateIds.length &&
    Number.isSafeInteger(snapshot.budgets.repairRounds) && snapshot.budgets.repairRounds >= 0 && Number.isSafeInteger(snapshot.budgets.ciReruns) && snapshot.budgets.ciReruns >= 0 &&
    isSafeId(snapshot.evidence.snapshotId) && isUtc(snapshot.evidence.observedAt) && snapshot.evidence.verification === 'VERIFIED' && snapshot.evidence.provenance === 'TRUSTED_READ_ONLY_ADAPTER' && ['FRESH', 'REPLAYED', 'UNVERIFIED'].includes(snapshot.evidence.replayStatus) && isSafeId(snapshot.evidence.policyVersion) && isDigest(snapshot.evidence.policySha256) && isDigest(snapshot.evidence.digest);
}

function pathClass(changedPath, policy) {
  if (changedPath === 'scripts/autonomous-policy' || changedPath.startsWith('scripts/autonomous-policy/')) return 'SELF';
  if (changedPath === 'scripts/autonomous-policy.node-test.mjs') return 'SELF';
  if (changedPath.startsWith('docs/maintainers/')) return 'ROOT';
  if (changedPath === 'package.json' || changedPath === 'pnpm-workspace.yaml') return 'ROOT';
  if (changedPath.startsWith('scripts/repository-contract')) return 'ROOT';
  if (policy.rootOfTrustPaths.some((entry) => changedPath === entry || changedPath.startsWith(`${entry}/`))) return 'ROOT';
  if (/^(\.github\/|\.agents\/|AGENTS\.md$|docs\/maintainers\/autonomous-(maintenance|integration-gate)\.md$)/.test(changedPath)) return 'ROOT';
  if (/\.(mjs|cjs|js|ts|tsx|jsx|json|ya?ml|toml|lock)$/.test(changedPath) || /(^|\/)(package\.json|pnpm-lock\.yaml)$/.test(changedPath)) return 'CODE';
  if (policy.lowRiskDocPrefixes.some((prefix) => changedPath.startsWith(`${prefix}/`)) && changedPath.endsWith('.md')) return 'DOC';
  return 'UNKNOWN';
}

/** Evaluate verified facts against a pinned policy. This pure Phase-1 evaluator never performs writes. */
export function evaluateIntegration(snapshot, policy) {
  const reasons = [];
  let decision = DECISION.WOULD_ALLOW;
  const markBlocked = (reason) => { reasons.push(reason); decision = DECISION.BLOCKED; };
  const markHuman = (reason) => { reasons.push(reason); if (decision !== DECISION.BLOCKED) decision = DECISION.HUMAN; };

  if (!validSnapshot(snapshot) || !validPolicy(policy)) {
    return safeOutput(DECISION.BLOCKED, [REASON.INVALID_EVIDENCE], snapshot, policy);
  }
  if (byteLength(stableJson({ snapshot, policy })) > LIMITS.serializedInputBytes) {
    return safeOutput(DECISION.BLOCKED, [REASON.INVALID_EVIDENCE], snapshot, policy);
  }

  const evaluatedAt = Date.parse(snapshot.evaluatedAt);
  if (policy.provenance.state !== 'VERIFIED' || policy.policySha256 !== canonicalPolicyDigest(policy) || snapshot.evidence.policyVersion !== policy.version || snapshot.evidence.policySha256 !== policy.policySha256) markBlocked(REASON.POLICY_BINDING_MISMATCH);
  if (policy.provenance.state !== 'VERIFIED' || policy.policySha256 !== canonicalPolicyDigest(policy)) markBlocked(REASON.POLICY_UNTRUSTED);
  if (snapshot.evaluatedAt < policy.validFrom || snapshot.evaluatedAt > policy.validUntil) markBlocked(REASON.POLICY_STALE);
  if (snapshot.evidence.digest !== canonicalSnapshotDigest(snapshot)) markBlocked(REASON.EVIDENCE_STALE);
  if (snapshot.evidence.replayStatus === 'REPLAYED') markBlocked(REASON.EVIDENCE_REPLAYED);
  if (snapshot.evidence.replayStatus !== 'FRESH') markBlocked(REASON.EVIDENCE_STALE);
  if (snapshot.task.repositoryId !== policy.repositoryId || !policy.trustedActorIds.includes(snapshot.actor.id) || snapshot.actor.provenance !== 'TRUSTED_ACTOR_PROVENANCE' || snapshot.actor.verification !== 'VERIFIED') markBlocked(REASON.ACTOR_UNVERIFIED);
  if (snapshot.task.contractDigest !== snapshot.task.approvedContractDigest) markBlocked(REASON.CONTRACT_DRIFT);
  if (!snapshot.pullRequest.pathSetComplete || !snapshot.pullRequest.untrackedFilesVerified) markBlocked(REASON.PATH_EVIDENCE_INCOMPLETE);
  if (snapshot.pullRequest.changedPaths.some(({ withinRepository }) => !withinRepository)) markBlocked(REASON.PATH_ESCAPES_REPOSITORY);
  if (snapshot.pullRequest.changedPaths.some(({ symlinkFree }) => !symlinkFree)) markBlocked(REASON.SYMLINK_PATH);
  if (snapshot.pullRequest.changedPaths.some(({ withinApprovedScope }) => !withinApprovedScope)) markBlocked(REASON.TASK_SCOPE_DRIFT);
  if (snapshot.pullRequest.authorId === snapshot.actor.id || snapshot.review.reviewerId === snapshot.actor.id || snapshot.review.reviewerId === snapshot.review.implementerId) markBlocked(REASON.SELF_APPROVAL);
  if (snapshot.pullRequest.state !== 'OPEN' || snapshot.pullRequest.baseBranch !== 'main' || snapshot.pullRequest.repositoryId !== snapshot.task.repositoryId || snapshot.pullRequest.taskIssueId !== snapshot.task.issueId) markBlocked(REASON.PR_NOT_ELIGIBLE);
  if (snapshot.pullRequest.baseSha !== snapshot.main.sha || snapshot.review.pullRequestId !== snapshot.pullRequest.id || snapshot.ci.pullRequestId !== snapshot.pullRequest.id || snapshot.review.headSha !== snapshot.pullRequest.headSha || snapshot.ci.headSha !== snapshot.pullRequest.headSha) markBlocked(REASON.PR_HEAD_MISMATCH);
  if (snapshot.main.verification !== 'VERIFIED' || snapshot.main.observedAt > snapshot.evaluatedAt || evaluatedAt - Date.parse(snapshot.main.observedAt) > policy.maximumEvidenceAgeMs) markBlocked(REASON.MAIN_STALE);
  if (snapshot.evidence.observedAt > snapshot.evaluatedAt || evaluatedAt - Date.parse(snapshot.evidence.observedAt) > policy.maximumEvidenceAgeMs) markBlocked(REASON.EVIDENCE_STALE);
  if ([snapshot.review.observedAt, snapshot.ci.observedAt].some((observedAt) => observedAt > snapshot.evaluatedAt || evaluatedAt - Date.parse(observedAt) > policy.maximumEvidenceAgeMs)) markBlocked(REASON.EVIDENCE_STALE);
  if (snapshot.evidence.verification !== 'VERIFIED' || snapshot.evidence.provenance !== 'TRUSTED_READ_ONLY_ADAPTER' || snapshot.review.provenance !== 'VERIFIED_AO_NATIVE_REVIEW' || snapshot.review.producer !== 'AO_NATIVE' || !snapshot.review.runId || !snapshot.review.githubReviewId || !snapshot.review.feedbackDelivered) markBlocked(REASON.REVIEW_UNVERIFIED);
  if (snapshot.review.runState !== 'COMPLETED') markBlocked(REASON.REVIEW_UNVERIFIED);
  if (snapshot.review.state !== 'APPROVED') markBlocked(REASON.REVIEW_NOT_APPROVED);
  if (snapshot.review.headSha !== snapshot.pullRequest.headSha) markBlocked(REASON.REVIEW_HEAD_MISMATCH);
  if (snapshot.review.openP0 > 0 || snapshot.review.openP1 > 0) markBlocked(REASON.REVIEW_FINDINGS_OPEN);
  if (snapshot.review.reviewerId === snapshot.review.authorId || snapshot.review.reviewerId === snapshot.review.implementerId) markBlocked(REASON.REVIEWER_NOT_INDEPENDENT);
  if (snapshot.ci.provenance !== 'VERIFIED') markBlocked(REASON.CI_UNVERIFIED);
  if (snapshot.ci.state !== 'PASS' || !snapshot.ci.requiredChecksComplete) markBlocked(REASON.CI_NOT_PASSING);
  if (snapshot.ci.headSha !== snapshot.pullRequest.headSha) markBlocked(REASON.CI_HEAD_MISMATCH);
  if (snapshot.dependencies.verification !== 'VERIFIED' || !snapshot.dependencies.allSatisfied) markBlocked(REASON.DEPENDENCY_UNSATISFIED);
  if (snapshot.wip.verification !== 'VERIFIED' || snapshot.wip.active >= Math.min(snapshot.wip.maximum, policy.maximumWip)) markBlocked(REASON.WIP_LIMIT_REACHED);
  if (snapshot.duplicates.verification !== 'VERIFIED' || snapshot.duplicates.candidateIds.length > 0) markBlocked(REASON.DUPLICATE_CANDIDATE);
  if (snapshot.budgets.repairRounds > policy.maximumRepairRounds) markBlocked(REASON.REPAIR_BUDGET_EXCEEDED);
  if (snapshot.budgets.ciReruns > policy.maximumCiReruns) markBlocked(REASON.CI_RERUN_BUDGET_EXCEEDED);

  const classes = snapshot.pullRequest.changedPaths.map(({ path: changedPath }) => pathClass(changedPath, policy));
  if (classes.includes('SELF')) markBlocked(REASON.SELF_POLICY_CHANGE);
  if (classes.includes('ROOT') || snapshot.task.risk === 'ROOT_OF_TRUST') markHuman(REASON.ROOT_OF_TRUST_CHANGE);
  if (snapshot.task.risk === 'HIGH') markHuman(REASON.HIGH_RISK_CHANGE);
  if (classes.includes('CODE')) markHuman(REASON.CODE_OR_CONFIG_CHANGE);
  if (classes.includes('UNKNOWN')) markHuman(REASON.UNKNOWN_PATH);
  if (snapshot.task.risk !== 'LOW') markHuman(REASON.RISK_NOT_LOW);

  return safeOutput(decision, reasons, snapshot, policy);
}
