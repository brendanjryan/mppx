import { Server } from 'prool'
import { Instance } from 'prool/testcontainers'
import { nodeEnv } from './config.js'
import { port } from './prool.js'

export default async function () {
  if (nodeEnv !== 'localnet') return

  const server = Server.create({
    instance: Instance.tempo(),
    port,
  })

  await server.start()

  // Arbitrary request to start server to trigger Docker image download.
  console.log('Downloading Docker image & starting Tempo server...')
  await fetch(`http://localhost:${port}/1/start`)
  console.log('Tempo server started.')

  return server.stop()
}
