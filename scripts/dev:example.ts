import * as child_process from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'

import * as TestContainers from 'prool/testcontainers'

const examplesDir = path.join(import.meta.dirname, '..', 'examples')
const localnetMnemonic = 'test test test test test test test test test test test junk'

function findExamples(dir: string, prefix = ''): { name: string; path: string }[] {
  const entries = fs.readdirSync(dir).filter((name) => {
    const fullPath = path.join(dir, name)
    return fs.statSync(fullPath).isDirectory() && name !== 'node_modules'
  })

  const results: { name: string; path: string }[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    const label = prefix ? `${prefix}/${entry}` : entry
    if (fs.existsSync(path.join(fullPath, 'package.json'))) {
      results.push({ name: label, path: fullPath })
    } else {
      results.push(...findExamples(fullPath, label))
    }
  }
  return results
}

const examples = findExamples(examplesDir)

if (examples.length === 0) {
  console.log('No examples found in examples/')
  process.exit(1)
}

const arg = process.argv[2]

if (arg) {
  const match = examples.find((e) => e.name === arg)
  if (!match) {
    console.log(`Example "${arg}" not found. Available: ${examples.map((e) => e.name).join(', ')}`)
    process.exit(1)
  }
  await runExample(match)
} else if (examples.length === 1) {
  await runExample(examples[0]!)
} else {
  console.log('Available examples:\n')
  for (const [i, example] of examples.entries()) console.log(`  ${i + 1}. ${example.name}`)
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question('Select example (number): ', async (answer) => {
    rl.close()
    const index = parseInt(answer, 10) - 1
    if (index >= 0 && index < examples.length) {
      await runExample(examples[index]!)
    } else {
      console.log('Invalid selection')
      process.exit(1)
    }
  })
}

async function runExample(example: { name: string; path: string }) {
  const env = { ...process.env }
  let cleanup = async () => {}

  if (example.name === 'subscription' && (env.MPPX_EXAMPLE_NETWORK ?? 'localnet') === 'localnet') {
    if (!env.MPPX_RPC_URL) {
      const port = Number(env.MPPX_RPC_PORT ?? 8545)
      console.log(`Starting ${example.name}...\n`)
      console.log(`Launching Tempo localnet container (internal port ${port})...\n`)
      const instance = TestContainers.Instance.tempo({
        blockTime: '200ms',
        mnemonic: localnetMnemonic,
        port,
      })
      await instance.start()
      env.MPPX_EXAMPLE_NETWORK = 'localnet'
      env.MPPX_RPC_URL = `http://127.0.0.1:${instance.port}`
      cleanup = async () => {
        await instance.stop().catch(() => {})
      }
      console.log(`Tempo localnet ready at ${env.MPPX_RPC_URL}\n`)
    }
  }

  console.log(`Starting ${example.name}...\n`)
  let cleanedUp = false
  const cleanupOnce = async () => {
    if (cleanedUp) return
    cleanedUp = true
    await cleanup()
  }
  const child = child_process.spawn('pnpm', ['dev'], {
    cwd: example.path,
    env,
    stdio: 'inherit',
    shell: true,
  })
  const stop = async (code = 0) => {
    await cleanupOnce()
    process.exit(code)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      child.kill(signal)
      void stop(0)
    })
  }

  child.on('exit', (code) => {
    void stop(code ?? 0)
  })
}
