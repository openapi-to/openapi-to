import {
  applyGenerationInputSchema,
  applyGenerationOutputSchema,
  checkGenerationInputSchema,
  checkGenerationOutputSchema,
  diffInputSchema,
  diffOutputSchema,
  openapiGenerateInputSchema,
  openapiGenerateOutputSchema,
  inspectInputSchema,
  inspectOutputSchema,
  prepareGenerationInputSchema,
  prepareGenerationOutputSchema,
  validateInputSchema,
  validateOutputSchema,
  listTargetsInputSchema,
  listTargetsOutputSchema,
  searchOperationsInputSchema,
  searchOperationsOutputSchema,
  getOperationInputSchema,
  getOperationOutputSchema,
} from './index.ts'

const diagnostics = {
  diagnostics: [],
  diagnosticSummary: { errors: 0, warnings: 0, infos: 0 },
  truncated: { diagnostics: false, totalDiagnostics: 0, returnedDiagnostics: 0, omittedDiagnostics: 0 },
}

const cases = [
  {
    name: 'list-targets',
    input: listTargetsInputSchema,
    validInput: {},
    invalidInput: 'targets',
    output: listTargetsOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_list_targets', success: false, targets: [], ...diagnostics },
  },
  {
    name: 'search-operations',
    input: searchOperationsInputSchema,
    validInput: { target: 'backend', query: 'GET /users', limit: 8 },
    invalidInput: { query: '', limit: 1000 },
    output: searchOperationsOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_search_operations', success: false, query: 'users', totalMatches: 0, items: [], ...diagnostics },
  },
  {
    name: 'get-operation',
    input: getOperationInputSchema,
    validInput: { target: 'backend', operationKey: 'getUser', detail: 'contract', schemaDepth: 2 },
    invalidInput: { operationKey: '', schemaDepth: 100 },
    output: getOperationOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_get_operation', success: false, found: false, detail: 'contract', ...diagnostics },
  },
  {
    name: 'validate',
    input: validateInputSchema,
    validInput: { source: 'openapi.yaml' },
    invalidInput: { source: '' },
    output: validateOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_validate', success: false, ...diagnostics },
  },
  {
    name: 'inspect',
    input: inspectInputSchema,
    validInput: { source: 'openapi.yaml', includeOperations: true },
    invalidInput: { source: 42 },
    output: inspectOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_inspect', success: false, ...diagnostics },
  },
  {
    name: 'diff',
    input: diffInputSchema,
    validInput: { before: 'before.yaml', after: 'after.yaml' },
    invalidInput: { before: 'before.yaml' },
    output: diffOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_diff', success: false, ...diagnostics },
  },
  {
    name: 'dry-run',
    input: openapiGenerateInputSchema,
    validInput: { target: 'sdk', selection: { type: 'operations', operationKeys: ['getUser'], strategy: 'add' }, includePreview: false },
    invalidInput: { target: 'sdk', selection: { type: 'operations', operationKeys: ['getUser'], strategy: 'ephemeral' } },
    output: openapiGenerateOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_generate', success: false, mode: 'dry-run', effect: 'preview', target: 'sdk', selection: { type: 'operations', requestedOperationKeys: ['getUser'] }, servers: [], ...diagnostics, truncated: { ...diagnostics.truncated, artifacts: false, totalArtifacts: 0, returnedArtifacts: 0, omittedArtifacts: 0, previews: false, omittedPreviewBytes: 0 } },
  },
  {
    name: 'check',
    input: checkGenerationInputSchema,
    validInput: { target: 'sdk' },
    invalidInput: { target: '' },
    output: checkGenerationOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_check_generation', success: false, basis: 'persisted', target: 'sdk', state: 'uninitialized', changes: [], summary: { added: 0, modified: 0, deleted: 0 }, ...diagnostics, truncated: { ...diagnostics.truncated, changes: false, totalChanges: 0, returnedChanges: 0, omittedChanges: 0 } },
  },
  {
    name: 'prepare',
    input: prepareGenerationInputSchema,
    validInput: { targets: ['sdk'], selection: { type: 'add', operationKeys: ['getUser'] } },
    invalidInput: { targets: ['sdk'], configPath: 'untrusted.cjs' },
    output: prepareGenerationOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_prepare_generation', success: false, ...diagnostics },
  },
  {
    name: 'apply',
    input: applyGenerationInputSchema,
    validInput: {
      planId: '123e4567-e89b-42d3-a456-426614174000',
      token: 'a'.repeat(32),
      approvedPlanHash: 'b'.repeat(64),
    },
    invalidInput: {
      planId: 'not-a-plan-id',
      token: 'short',
      approvedPlanHash: 'not-a-hash',
    },
    output: applyGenerationOutputSchema,
    validOutput: {
      schemaVersion: 1,
      tool: 'openapi_apply_generation',
      success: false,
      applied: false,
      rollbackPerformed: false,
      ...diagnostics,
    },
  },
] as const

describe('MCP Tool schemas', () => {
  it.each(cases)('$name accepts its bounded contract and rejects malformed values', ({ input, validInput, invalidInput, output, validOutput }) => {
    expect(input.safeParse(validInput).success).toBe(true)
    expect(input.safeParse(invalidInput).success).toBe(false)
    expect(output.safeParse(validOutput).success).toBe(true)
    expect(output.safeParse({ ...validOutput, tool: 'wrong_tool' }).success).toBe(false)
  })

  it('preserves legacy analysis input compatibility and rejects authority fields on generation inputs', () => {
    const schemas = [
      [listTargetsInputSchema, {}],
      [searchOperationsInputSchema, { target: 'backend', query: 'users' }],
      [getOperationInputSchema, { target: 'backend', operationKey: 'getUser' }],
      [validateInputSchema, { source: 'openapi.yaml' }],
      [inspectInputSchema, { source: 'openapi.yaml' }],
      [diffInputSchema, { before: 'before.yaml', after: 'after.yaml' }],
      [checkGenerationInputSchema, { target: 'sdk' }],
    ] as const

    expect(listTargetsInputSchema.safeParse({ allowedHosts: ['untrusted.test'] }).success).toBe(false)
    expect(checkGenerationInputSchema.safeParse({ target: 'sdk', allowedHosts: ['untrusted.test'] }).success).toBe(false)
    for (const [schema, input] of schemas.slice(1, -1)) {
      expect(schema.parse({ ...input, allowedHosts: ['untrusted.test'] })).toEqual(input)
    }
    expect(openapiGenerateInputSchema.safeParse({
      target: 'sdk',
      selection: { type: 'full' },
      configPath: '../untrusted.js',
    }).success).toBe(false)
  })

  it('keeps full and add Prepare compatible while allowing only non-empty bounded replace mutations', () => {
    expect(prepareGenerationInputSchema.safeParse({ targets: ['sdk'] }).success).toBe(true)
    expect(prepareGenerationInputSchema.safeParse({ targets: ['sdk'], selection: { type: 'add', operationKeys: [] } }).success).toBe(true)
    expect(prepareGenerationInputSchema.safeParse({ targets: ['sdk'], selection: { type: 'replace', operationKeys: ['getUser'] } }).success).toBe(true)
    expect(prepareGenerationInputSchema.safeParse({ targets: ['sdk'], selection: { type: 'replace', operationKeys: [] } }).success).toBe(false)
    const operationKeys = (count: number) => Array.from({ length: count }, (_, index) => `operation${index}`)
    expect(prepareGenerationInputSchema.safeParse({ selection: { type: 'add', operationKeys: operationKeys(500) } }).success).toBe(true)
    expect(prepareGenerationInputSchema.safeParse({ selection: { type: 'add', operationKeys: operationKeys(501) } }).success).toBe(false)
    expect(prepareGenerationInputSchema.safeParse({ selection: { type: 'replace', operationKeys: operationKeys(500) } }).success).toBe(true)
    expect(prepareGenerationInputSchema.safeParse({ selection: { type: 'replace', operationKeys: operationKeys(501) } }).success).toBe(true)
    expect(prepareGenerationInputSchema.safeParse({ selection: { type: 'replace', operationKeys: operationKeys(5_000) } }).success).toBe(true)
    expect(prepareGenerationInputSchema.safeParse({ selection: { type: 'replace', operationKeys: operationKeys(5_001) } }).success).toBe(false)
    expect(prepareGenerationInputSchema.safeParse({ selection: { type: 'replace', operationKeys: ['界'.repeat(167)] } }).success).toBe(false)
    for (const selection of [
      { type: 'remove', operationKeys: ['getUser'] },
      { type: 'add', operationKeys: ['getUser'], path: 'selection.json' },
      { type: 'replace', operationKeys: ['getUser'], clean: true },
    ]) expect(prepareGenerationInputSchema.safeParse({ targets: ['sdk'], selection }).success).toBe(false)
  })
})
