import { defineConfig } from 'vite'

import { buildPage } from '../vite.js'

export default defineConfig({
  plugins: [buildPage()],
})
