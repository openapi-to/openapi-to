import { createHash } from 'node:crypto';
import { canonicalPolicyDigest } from './evaluator.mjs';
import { INTAKE_POLICY_VERSION, INTAKE_SCHEMA_VERSION } from './model.mjs';

const sha = (letter) => `sha256:${letter.repeat(64)}`;

export function validFixture(overrides = {}) {
  const issue = {
    repository: { name: 'example/project', numericId: 123456 },
    id: 260,
    state: 'OPEN',
    title: 'Improve a low-risk maintainer guide',
    body: 'Synthetic fixture only.',
    labels: [],
    assignees: [],
    ...overrides.issue,
  };
  const policy = {
    version: INTAKE_POLICY_VERSION,
    sha256: sha('0'),
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2027-01-01T00:00:00.000Z',
    repository: { name: 'example/project', numericId: 123456 },
    maximumWip: 4,
    allowedModes: ['AUTONOMOUS', 'DESIGN_APPROVED', 'MANUAL'],
    allowedPathPrefixes: ['docs/maintainers/'],
    fixtureOnly: true,
    ...overrides.policy,
  };
  policy.sha256 = canonicalPolicyDigest(policy);
  const contractDigest = `sha256:${createHashValue(JSON.stringify([issue.title, issue.body]))}`;
  const taskBaseSha = sha('a');
  const receipt = {
    kind: 'mock-verified-receipt',
    verifier: 'fixture-v1',
    repositoryId: issue.repository.numericId,
    issueId: issue.id,
    actorVerified: true,
    mode: 'AUTONOMOUS',
    contractDigest,
    policyVersion: policy.version,
    policySha256: policy.sha256,
    taskBaseSha,
    issuedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: '2026-10-15T00:00:00.000Z',
    revoked: false,
    nonce: 'fixture-nonce-0001',
    ...overrides.receipt,
  };
  const snapshot = {
    schemaVersion: INTAKE_SCHEMA_VERSION,
    evaluationTime: '2026-10-09T00:00:00.000Z',
    issue,
    receipt,
    facts: {
      risk: 'LOW',
      writeSurface: 'LOW_RISK_DOCS_ONLY',
      paths: [{ path: 'docs/maintainers/example.md', withinOwnedSurface: true, symlinkFree: true }],
      nativeBlockers: [],
      dependencies: [],
      wip: { active: 1, maximum: 4 },
      duplicates: { sessions: [], branches: [], pullRequests: [] },
      main: { expectedSha: taskBaseSha, observedSha: taskBaseSha },
      replayedNonces: [],
    },
    hostCapabilities: { ao: 'VERIFIED', github: 'VERIFIED', shell: 'VERIFIED' },
    adapterState: 'VERIFIED',
    fixtureOnly: true,
    ...overrides.snapshot,
  };
  return { snapshot, policy };
}

function createHashValue(value) {
  // The fixture keeps its only crypto dependency in Node's built-in modules.
  return createHash('sha256').update(value).digest('hex');
}
