import { resolveJSONPointer } from './refResolver.ts'

export type LocatedParameter = {
  value: Record<string, unknown>
  path: Array<string | number>
  reference?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function identity(value: Record<string, unknown>): string | undefined {
  if (typeof value.in !== 'string' || typeof value.name !== 'string') return undefined
  const name = value.in === 'header' ? value.name.toLowerCase() : value.name
  return `${value.in}\0${name}`
}

/** Resolve local Parameter references, then apply Operation overrides by (name, in). */
export function effectiveParameters(
  root: unknown,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  pathItemPath: Array<string | number> = [],
  operationPath: Array<string | number> = [],
): LocatedParameter[] {
  const byIdentity = new Map<string, LocatedParameter>()
  const entries: LocatedParameter[] = []
  const add = (owner: Record<string, unknown>, ownerPath: Array<string | number>) => {
    if (!Array.isArray(owner.parameters)) return
    for (const [index, raw] of owner.parameters.entries()) {
      if (!record(raw)) continue
      let value: unknown = raw
      const reference = typeof raw.$ref === 'string' ? raw.$ref : undefined
      const seen = new Set<string>()
      for (let depth = 0; depth < 20 && record(value) && typeof value.$ref === 'string'; depth += 1) {
        if (seen.has(value.$ref)) { value = undefined; break }
        seen.add(value.$ref)
        const resolved = resolveJSONPointer(root, value.$ref)
        value = resolved.found ? resolved.value : undefined
      }
      if (!record(value) || typeof value.$ref === 'string') {
        if (reference) entries.push({ value: {}, path: [...ownerPath, 'parameters', index], reference })
        continue
      }
      const located = { value, path: [...ownerPath, 'parameters', index], ...(reference ? { reference } : {}) }
      const key = identity(value)
      if (key === undefined) entries.push(located)
      else if (!byIdentity.has(key)) byIdentity.set(key, located)
    }
  }
  add(operation, operationPath)
  add(pathItem, pathItemPath)
  return [...byIdentity.values(), ...entries]
}
