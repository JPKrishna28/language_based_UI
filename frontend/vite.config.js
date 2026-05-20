import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, createReadStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'url'

const require = createRequire(import.meta.url)
const gtts = require('node-gtts')

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'tts_cache')
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR)

function gttsPlugin() {
  return {
    name: 'gtts-middleware',
    configureServer(server) {
      server.middlewares.use('/api/tts', (req, res) => {
        const { query } = parse(req.url, true)
        const text = String(query.text || '').trim().slice(0, 500)
        const lang = String(query.lang || 'hi').trim()

        if (!text) {
          res.statusCode = 400
          return res.end('missing text')
        }

        const key = createHash('sha1').update(`${lang}|${text}`).digest('hex')
        const cacheFile = join(CACHE_DIR, `${key}.mp3`)

        res.setHeader('Content-Type', 'audio/mpeg')
        res.setHeader('Cache-Control', 'public, max-age=86400')

        if (existsSync(cacheFile)) {
          return createReadStream(cacheFile).pipe(res)
        }

        gtts(lang).save(cacheFile, text, err => {
          if (err) {
            res.statusCode = 500
            return res.end(`TTS error: ${err.message}`)
          }
          createReadStream(cacheFile).pipe(res)
        })
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), gttsPlugin()],
  server: {
    host: true,   // binds to 0.0.0.0 — accessible from phone on same WiFi
    port: 5173,
  },
})
