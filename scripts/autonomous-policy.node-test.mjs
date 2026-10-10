import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalContractDigest,
  canonicalPolicyDigest,
  canonicalSnapshotDigest,
  evaluateIntegration,
} from './autonomous-policy/evaluator.mjs';
import { DECISION, POLICY_SCHEMA_VERSION, REASON } from './autonomous-policy/model.mjs';

const sha = (character) => character.repeat(40);

function fixture(overrides = {}) {
  const contract = { issueId: 261, scope: 'bounded shadow policy gate', revision: 1 };
  const policy = {
    schemaVersion: POLICY_SCHEMA_VERSION,
    version: '1.0.0-shadow',
    enabled: true,
    policySha256: '',
    validFrom: '2026-10-01T00:00:00.000Z',
    validUntil: '2026-11-01T00:00:00.000Z',
    repositoryId: 646310819,
    trustedActorIds: ['maintainer-1'],
    maximumEvidenceAgeMs: 24 * 60 * 60 * 1000,
    maximumRepairRounds: 2,
    maximumCiReruns: 1,
    maximumWip: 4,
    lowRiskDocPrefixes: ['docs/product'],
    rootOfTrustPaths: [
      'AGENTS.md',
      'docs/maintainers/autonomous-maintenance.md',
      'docs/maintainers/autonomous-integration-gate.md',
      '.github',
      '.agents',
      'scripts/repository-contract.mjs',
      'scripts/repository-contract.node-test.mjs',
      'scripts/autonomous-policy',
      'pnpm-lock.yaml',
    ],
    provenance: { state: 'VERIFIED', authority: 'TRUSTED_POLICY_SOURCE', policySha256: '' },
  };
  policy.policySha256 = canonicalPolicyDigest(policy);
  policy.provenance.policySha256 = policy.policySha256;

  const snapshot = {
    schemaVersion: POLICY_SCHEMA_VERSION,
    evaluatedAt: '2026-10-10T00:00:00.000Z',
    task: {
      repositoryId: 646310819,
      issueId: 261,
      contractDigest: canonicalContractDigest(contract),
      approvedContractDigest: canonicalContractDigest(contract),
      risk: 'LOW',
      riskEvidence: 'VERIFIED',
      activation: {
        mode: 'AUTONOMOUS',
        state: 'VERIFIED',
        provenance: 'TRUSTED_TASK_ACTIVATION',
        repositoryId: 646310819,
        issueId: 261,
        actorId: 'maintainer-1',
        contractDigest: canonicalContractDigest(contract),
        policyVersion: policy.version,
        policySha256: policy.policySha256,
      },
    },
    pullRequest: {
      id: 300,
      repositoryId: 646310819,
      taskIssueId: 261,
      state: 'OPEN',
      baseBranch: 'main',
      baseSha: sha('a'),
      headSha: sha('b'),
      authorId: 'implementer',
      changedPaths: [{ path: 'docs/product/usage.md', withinRepository: true, symlinkFree: true, withinApprovedScope: true }],
      pathSetComplete: true,
      untrackedFilesVerified: true,
    },
    main: { sha: sha('a'), observedAt: '2026-10-09T23:30:00.000Z', verification: 'VERIFIED' },
    actor: { id: 'maintainer-1', verification: 'VERIFIED', provenance: 'TRUSTED_ACTOR_PROVENANCE' },
    review: {
      state: 'APPROVED',
      runState: 'COMPLETED',
      producer: 'AO_NATIVE',
      runId: 'review-run-44',
      observedAt: '2026-10-09T23:50:00.000Z',
      pullRequestId: 300,
      headSha: sha('b'),
      reviewerId: 'reviewer-2',
      authorId: 'implementer',
      implementerId: 'implementer',
      provenance: 'VERIFIED_AO_NATIVE_REVIEW',
      githubReviewId: 'github-review-55',
      feedbackDelivered: true,
      openP0: 0,
      openP1: 0,
    },
    ci: {
      state: 'PASS',
      source: 'GITHUB_ACTIONS',
      runId: 'run-66',
      observedAt: '2026-10-09T23:50:00.000Z',
      pullRequestId: 300,
      headSha: sha('b'),
      requiredChecksComplete: true,
      provenance: 'VERIFIED',
    },
    dependencies: { verification: 'VERIFIED', allSatisfied: true, ids: ['260'] },
    wip: { verification: 'VERIFIED', active: 1, maximum: 4 },
    duplicates: { verification: 'VERIFIED', candidateIds: [] },
    budgets: { repairRounds: 1, ciReruns: 0 },
    evidence: {
      snapshotId: 'snapshot-2026-10-10-1',
      observedAt: '2026-10-09T23:45:00.000Z',
      verification: 'VERIFIED',
      provenance: 'TRUSTED_READ_ONLY_ADAPTER',
      replayStatus: 'FRESH',
      policyVersion: policy.version,
      policySha256: policy.policySha256,
      digest: '',
    },
  };
  Object.assign(policy, overrides.policy);
  policy.policySha256 = canonicalPolicyDigest(policy);
  policy.provenance.policySha256 = policy.policySha256;
  Object.assign(snapshot.task.activation, {
    policyVersion: policy.version,
    policySha256: policy.policySha256,
  });
  Object.assign(snapshot, overrides.snapshot);
  for (const [key, value] of Object.entries(overrides)) {
    if (!['policy', 'snapshot'].includes(key) && snapshot[key] && typeof snapshot[key] === 'object' && value && typeof value === 'object') {
      if (key === 'task' && value.activation) Object.assign(snapshot.task.activation, value.activation);
      Object.assign(snapshot[key], Object.fromEntries(Object.entries(value).filter(([field]) => key !== 'task' || field !== 'activation')));
    }
  }
  snapshot.evidence.digest = canonicalSnapshotDigest(snapshot);
  return { snapshot, policy };
}

const evaluate = (overrides) => {
  const { snapshot, policy } = fixture(overrides);
  return evaluateIntegration(snapshot, policy);
};
const hasReason = (result, reason) => assert.ok(result.reasonCodes.includes(reason), `${reason}: ${result.reasonCodes.join(', ')}`);

test('complete synthetic low-risk documentation evidence yields shadow WOULD_ALLOW only', () => {
  const { snapshot, policy } = fixture();
  const before = structuredClone({ snapshot, policy });
  const result = evaluateIntegration(snapshot, policy);
  assert.equal(result.decision, DECISION.WOULD_ALLOW);
  assert.equal(result.shadowOnly, true);
  assert.equal(result.enqueueAuthorized, false);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.binding.contractDigest, snapshot.task.contractDigest);
  assert.equal(result.evidence.aoReviewRunId, snapshot.review.runId);
  assert.equal(result.evidence.githubReviewId, snapshot.review.githubReviewId);
  assert.equal(result.evidence.ciRunId, snapshot.ci.runId);
  assert.deepEqual({ snapshot, policy }, before, 'evaluation must not mutate caller evidence');
});

test('untrusted, missing, forged, stale, and wrongly bound evidence fails closed', () => {
  const missing = evaluateIntegration(null, null);
  assert.equal(missing.decision, DECISION.BLOCKED);
  hasReason(missing, REASON.INVALID_EVIDENCE);

  for (const overrides of [
    { actor: { verification: 'UNVERIFIED' } },
    { actor: { provenance: 'UNVERIFIED' } },
    { actor: { id: 'untrusted-actor' } },
    { task: { activation: { state: 'UNVERIFIED', provenance: 'UNVERIFIED' } } },
    { evidence: { provenance: 'UNTRUSTED_JSON' } },
    { evidence: { replayStatus: 'UNVERIFIED' } },
    { main: { verification: 'UNVERIFIED' } },
    { review: { provenance: 'UNVERIFIED' } },
    { ci: { provenance: 'UNVERIFIED' } },
    { dependencies: { verification: 'UNVERIFIED' } },
    { wip: { verification: 'UNVERIFIED' } },
    { duplicates: { verification: 'UNVERIFIED' } },
  ]) {
    assert.equal(evaluate(overrides).decision, DECISION.BLOCKED);
  }
  hasReason(evaluate({ policy: { version: 'forged-policy' } }), REASON.POLICY_BINDING_MISMATCH);
  hasReason(evaluate({ policy: { enabled: false } }), REASON.POLICY_DISABLED);
  hasReason(evaluate({ task: { activation: { actorId: 'forged-actor' } } }), REASON.ACTIVATION_BINDING_MISMATCH);
  hasReason(evaluate({ task: { activation: { state: 'UNVERIFIED', provenance: 'UNVERIFIED' } } }), REASON.ACTIVATION_UNVERIFIED);
  hasReason(evaluate({ task: { activation: { contractDigest: `sha256:${'f'.repeat(64)}` } } }), REASON.ACTIVATION_BINDING_MISMATCH);
  hasReason(evaluate({ task: { activation: { policyVersion: 'stale-policy' } } }), REASON.ACTIVATION_BINDING_MISMATCH);
  hasReason(evaluate({ actor: { id: 'implementer' } }), REASON.SELF_APPROVAL);
  hasReason(evaluate({ evidence: { observedAt: '2026-10-08T00:00:00.000Z' } }), REASON.EVIDENCE_STALE);
  hasReason(evaluate({ evidence: { replayStatus: 'REPLAYED' } }), REASON.EVIDENCE_REPLAYED);
  const altered = fixture();
  altered.snapshot.review.githubReviewId = 'unbound-review';
  hasReason(evaluateIntegration(altered.snapshot, altered.policy), REASON.EVIDENCE_STALE);
});

test('contract drift, PR head drift, stale main, AO review provenance, and CI provenance block', () => {
  for (const [overrides, reason] of [
    [{ task: { approvedContractDigest: `sha256:${'f'.repeat(64)}` } }, REASON.CONTRACT_DRIFT],
    [{ pullRequest: { pathSetComplete: false } }, REASON.PATH_EVIDENCE_INCOMPLETE],
    [{ pullRequest: { untrackedFilesVerified: false } }, REASON.PATH_EVIDENCE_INCOMPLETE],
    [{ pullRequest: { changedPaths: [{ path: 'docs/product/usage.md', withinRepository: true, symlinkFree: false, withinApprovedScope: true }] } }, REASON.SYMLINK_PATH],
    [{ pullRequest: { changedPaths: [{ path: 'docs/product/usage.md', withinRepository: false, symlinkFree: true, withinApprovedScope: true }] } }, REASON.PATH_ESCAPES_REPOSITORY],
    [{ pullRequest: { changedPaths: [{ path: 'docs/product/usage.md', withinRepository: true, symlinkFree: true, withinApprovedScope: false }] } }, REASON.TASK_SCOPE_DRIFT],
    [{ pullRequest: { baseSha: sha('c') } }, REASON.PR_HEAD_MISMATCH],
    [{ main: { observedAt: '2026-10-08T00:00:00.000Z' } }, REASON.MAIN_STALE],
    [{ review: { producer: 'UNVERIFIED_REVIEWER' } }, REASON.REVIEW_UNVERIFIED],
    [{ review: { state: 'CHANGES_REQUESTED' } }, REASON.REVIEW_NOT_APPROVED],
    [{ review: { runState: 'IN_PROGRESS' } }, REASON.REVIEW_UNVERIFIED],
    [{ review: { observedAt: '2026-10-08T00:00:00.000Z' } }, REASON.EVIDENCE_STALE],
    [{ pullRequest: { taskIssueId: 999 } }, REASON.PR_NOT_ELIGIBLE],
    [{ review: { headSha: sha('c') } }, REASON.PR_HEAD_MISMATCH],
    [{ review: { openP1: 1 } }, REASON.REVIEW_FINDINGS_OPEN],
    [{ review: { reviewerId: 'implementer' } }, REASON.SELF_APPROVAL],
    [{ review: { authorId: 'another-author' } }, REASON.REVIEW_AUTHOR_MISMATCH],
    [{ ci: { state: 'PENDING' } }, REASON.CI_NOT_PASSING],
    [{ ci: { observedAt: '2026-10-08T00:00:00.000Z' } }, REASON.EVIDENCE_STALE],
    [{ ci: { headSha: sha('c') } }, REASON.PR_HEAD_MISMATCH],
    [{ evidence: { policySha256: `sha256:${'f'.repeat(64)}` } }, REASON.POLICY_BINDING_MISMATCH],
  ]) hasReason(evaluate(overrides), reason);
});

test('risk and changed-path classifier keep code, config, unknown, and governance changes out of WOULD_ALLOW', () => {
  for (const [path, reason] of [
    ['packages/core/src/index.ts', REASON.CODE_OR_CONFIG_CHANGE],
    ['.github/workflows/quality.yml', REASON.ROOT_OF_TRUST_CHANGE],
    ['docs/maintainers/autonomous-integration-gate.md', REASON.ROOT_OF_TRUST_CHANGE],
    ['docs/product/AGENTS.md', REASON.ROOT_OF_TRUST_CHANGE],
    ['scripts/autonomous-policy/evaluator.mjs', REASON.SELF_POLICY_CHANGE],
    ['scripts/autonomous-policy.node-test.mjs', REASON.SELF_POLICY_CHANGE],
    ['mystery/policy.txt', REASON.UNKNOWN_PATH],
  ]) {
    const result = evaluate({ pullRequest: { changedPaths: [{ path, withinRepository: true, symlinkFree: true, withinApprovedScope: true }] } });
    assert.notEqual(result.decision, DECISION.WOULD_ALLOW, path);
    hasReason(result, reason);
  }
  for (const risk of ['MEDIUM', 'HIGH', 'ROOT_OF_TRUST', 'UNKNOWN']) {
    assert.notEqual(evaluate({ task: { risk } }).decision, DECISION.WOULD_ALLOW, risk);
  }
  assert.equal(evaluate({ task: { risk: 'HIGH' } }).decision, DECISION.HUMAN);
  assert.equal(evaluate({ task: { risk: 'ROOT_OF_TRUST' } }).decision, DECISION.HUMAN);
  for (const mode of ['MANUAL', 'DESIGN_APPROVED']) {
    const result = evaluate({ task: { activation: { mode } } });
    assert.equal(result.decision, DECISION.HUMAN);
    hasReason(result, REASON.AUTHORIZATION_MODE_REQUIRES_HUMAN);
  }
  assert.equal(evaluate({ policy: { enabled: false } }).decision, DECISION.BLOCKED);
});

test('dependency, WIP, duplicate, and repair or rerun budget evidence is enforced', () => {
  for (const [overrides, reason] of [
    [{ dependencies: { allSatisfied: false } }, REASON.DEPENDENCY_UNSATISFIED],
    [{ wip: { active: 4 } }, REASON.WIP_LIMIT_REACHED],
    [{ duplicates: { candidateIds: ['existing-pr-300'] } }, REASON.DUPLICATE_CANDIDATE],
    [{ budgets: { repairRounds: 3 } }, REASON.REPAIR_BUDGET_EXCEEDED],
    [{ budgets: { ciReruns: 2 } }, REASON.CI_RERUN_BUDGET_EXCEEDED],
  ]) hasReason(evaluate(overrides), reason);
});

test('deterministic output, sorted reason codes, bounded serialization, and zero external-write surface', async () => {
  const { snapshot, policy } = fixture({ ci: { state: 'FAIL' }, dependencies: { allSatisfied: false } });
  const one = evaluateIntegration(snapshot, policy);
  const two = evaluateIntegration(structuredClone(snapshot), structuredClone(policy));
  assert.deepEqual(one, two);
  assert.deepEqual(one.reasonCodes, [...one.reasonCodes].sort());
  assert.ok(Buffer.byteLength(JSON.stringify(one), 'utf8') <= 8 * 1024);
  assert.equal(one.enqueueAuthorized, false);

  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./autonomous-policy/evaluator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|child_process|https?:\/\/|\.writeFile\s*\(|\.exec\s*\(/);
});
