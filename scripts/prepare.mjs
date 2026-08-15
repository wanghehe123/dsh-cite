// Git-install build entry. Published tarballs ship built artifacts and skip
// this step; a git dependency has no lib/ yet, so build from source here.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (existsSync(resolve(packageDir, 'lib/index.js')) && existsSync(resolve(packageDir, 'lib/client.js'))) {
  process.exit(0)
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['run', 'build'], { cwd: packageDir, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
