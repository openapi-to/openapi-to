import {
  applyGenerationInputSchema,
  applyGenerationOutputSchema,
  checkGenerationInputSchema,
  checkGenerationOutputSchema,
  diffInputSchema,
  diffOutputSchema,
  generateDryRunInputSchema,
  generateDryRunOutputSchema,
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
    input: generateDryRunInputSchema,
    validInput: { targets: ['sdk'], scope: { type: 'operations', operationKeys: ['getUser'] }, includePreview: false },
    invalidInput: { targets: [''] },
    output: generateDryRunOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_generate_dry_run', success: false, ...diagnostics },
  },
  {
    name: 'check',
    input: checkGenerationInputSchema,
    validInput: { targets: ['sdk'] },
    invalidInput: { targets: Array.from({ length: 101 }, () => 'sdk') },
    output: checkGenerationOutputSchema,
    validOutput: { schemaVersion: 1, tool: 'openapi_check_generation', success: false, ...diagnostics },
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

  it('preserves legacy extra-field stripping for non-write Tool inputs', () => {
    const schemas = [
      [listTargetsInputSchema, {}],
      [searchOperationsInputSchema, { target: 'backend', query: 'users' }],
      [getOperationInputSchema, { target: 'backend', operationKey: 'getUser' }],
      [validateInputSchema, { source: 'openapi.yaml' }],
      [inspectInputSchema, { source: 'openapi.yaml' }],
      [diffInputSchema, { before: 'before.yaml', after: 'after.yaml' }],
      [checkGenerationInputSchema, { targets: ['sdk'] }],
    ] as const

    for (const [schema, input] of schemas) {
      expect(schema.parse({ ...input, allowPrivateNetwork: true })).toEqual(input)
    }
    expect(generateDryRunInputSchema.parse({
      targets: ['sdk'],
      configPath: '../untrusted.js',
      scope: { type: 'full', outputRoot: '../outside' },
    })).toEqual({ targets: ['sdk'], scope: { type: 'full' } })
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
