import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = path.join(repositoryRoot, 'packages/mcp/bin/openapi-to-mcp.js')

function launch() {
  return spawn(process.execPath, [bin, '--workspace-root', repositoryRoot, '--log-level', 'silent'], { stdio: ['pipe', 'pipe', 'pipe'] })
}

function exited(child: ReturnType<typeof launch>, timeoutMs = 3_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP subprocess did not exit within its lifecycle deadline.')), timeoutMs)
    child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
}

describe('stdio subprocess lifecycle', { concurrent: false }, () => {
  it('exits cleanly on stdin EOF without protocol stdout pollution', async () => {
    const child = launch()
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stdin.end()
    expect(await exited(child)).toBe(0)
    expect(stdout).toBe('')
  })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(`does not remain orphaned after ${signal}`, async () => {
      const child = launch()
      await new Promise((resolve) => setTimeout(resolve, 200))
      child.kill(signal)
      await expect(exited(child)).resolves.not.toBeUndefined()
    })
  }
})
