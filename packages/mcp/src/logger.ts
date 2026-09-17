import process from 'node:process'

export interface McpLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export function safeLogText(value: string, limit = 500): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, (raw) => {
      try {
        const url = new URL(raw)
        url.username = ''
        url.password = ''
        url.search = ''
        return url.toString()
      } catch {
        return '[redacted URL]'
      }
    })
    .replace(/\b(authorization|cookie|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, limit)
}

export function safeLogData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? safeLogText(value) : value
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeLogData(item, seen))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/authorization|cookie|token|secret|password|content|preview|environment/i.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 30)
      .map(([key, item]) => [key, safeLogData(item, seen)]),
  )
}

const LOG_PRIORITY = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const

export function createStderrLogger(options: { format?: 'text' | 'json'; level?: keyof typeof LOG_PRIORITY } = {}): McpLogger {
  const format = options.format ?? 'text'
  const minimum = LOG_PRIORITY[options.level ?? 'info']
  const write = (level: string, message: string, data?: unknown) => {
    const normalizedLevel = level.toLowerCase() as Exclude<keyof typeof LOG_PRIORITY, 'silent'>
    if (LOG_PRIORITY[normalizedLevel] < minimum) return
    const safeData = data === undefined ? undefined : safeLogData(data)
    if (format === 'json') {
      process.stderr.write(`${JSON.stringify({ level: normalizedLevel, event: safeLogText(message), ...(safeData && typeof safeData === 'object' ? safeData : safeData === undefined ? {} : { data: safeData }) })}\n`)
      return
    }
    const suffix = safeData === undefined ? '' : ` ${JSON.stringify(safeData)}`
    process.stderr.write(`[openapi-to-mcp] ${level} ${safeLogText(message)}${suffix}\n`)
  }
  return {
    debug: (message, data) => write('DEBUG', message, data),
    info: (message, data) => write('INFO', message, data),
    warn: (message, data) => write('WARN', message, data),
    error: (message, data) => write('ERROR', message, data),
  }
}

export function redirectIncidentalConsoleToStderr(): void {
  const redirect = (...values: unknown[]) => {
    process.stderr.write(`${values.map((value) => (typeof value === 'string' ? safeLogText(value, 1000) : JSON.stringify(safeLogData(value)))).join(' ')}\n`)
  }
  console.log = redirect
  console.info = redirect
  console.debug = redirect
}
