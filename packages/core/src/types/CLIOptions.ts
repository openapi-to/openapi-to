//import type { LogLevel } from 'consola'

export type CLIOptions = {
  /**
   * Log level to report when using the CLI
   *
   * `silent` will hide all information that is not relevant
   *
   * `info` will show all information possible(not related to the PluginManager)
   *
   * `debug` will show all information possible(related to the PluginManager), handy for seeing logs
   * @default `silent`
   */
  logLevel?: 0 | 1 | 2 | 3 | 4 | 5 | (number & {})
  json?: boolean
  dryRun?: boolean
  check?: boolean
  debug?: boolean
  /** Optional library-only boundary for local OpenAPI inputs and transitive file references. */
  localFileRoot?: string
  /** Cancels only this build invocation. */
  signal?: AbortSignal
  /** @internal A shared transaction lock held by a trusted writer such as MCP Apply. */
  outputWriteLock?: import('../artifacts/transaction.ts').OutputWriteLock
  /** @internal Allow read-only MCP checks to report drift in previously owned files. */
  allowManagedDrift?: boolean
}
