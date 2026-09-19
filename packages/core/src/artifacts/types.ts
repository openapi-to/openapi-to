import type { SourceFile } from 'ts-morph'
import type { Diagnostic } from '../diagnostics.ts'

export type GeneratedArtifact =
  | { kind: 'typescript'; path: string; sourceFile: SourceFile; plugin?: string }
  | { kind: 'text'; path: string; content: string; plugin?: string }
  | { kind: 'json'; path: string; value: unknown; plugin?: string }
  | { kind: 'binary'; path: string; content: Uint8Array; plugin?: string }

export type ArtifactStatus = 'added' | 'modified' | 'deleted' | 'unchanged'

export interface MaterializedArtifact {
  kind: GeneratedArtifact['kind']
  path: string
  relativePath: string
  content: Uint8Array
  hash: string
  plugin?: string
}

export interface GenerationManifestEntry {
  path: string
  status: ArtifactStatus
  hash?: string
  previousHash?: string
  bytes?: number
  /** A fail-closed ownership conflict retained only for locked revalidation. */
  ownershipConflict?: 'unmanaged' | 'managed-changed'
}

export class OutputUnmanagedPathConflictError extends Error {
  readonly code = 'OUTPUT_UNMANAGED_PATH_CONFLICT'

  constructor(readonly relativePath: string) {
    super(`Generated artifact conflicts with an unmanaged existing path: ${relativePath}`)
    this.name = 'OutputUnmanagedPathConflictError'
  }
}

export class OutputManagedPathChangedError extends Error {
  readonly code = 'OUTPUT_MANAGED_PATH_CHANGED'

  constructor(readonly relativePath: string) {
    super(`Managed generated artifact changed since the ownership manifest was written: ${relativePath}`)
    this.name = 'OutputManagedPathChangedError'
  }
}

export interface GenerationManifest {
  outputRoot: string
  entries: GenerationManifestEntry[]
  summary: Record<ArtifactStatus, number>
  outdated: boolean
}

export interface GenerationResult {
  artifacts: GeneratedArtifact[]
  diagnostics: Diagnostic[]
  manifest: GenerationManifest
  written: boolean
}

export interface MaterializeArtifactOptions {
  /** Maximum serialized size for one artifact. Defaults to 64 MiB. */
  maxArtifactBytes?: number
  signal?: AbortSignal
}
