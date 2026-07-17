import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, createReadStream, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'url'
import { fetchTTS } from './api/_gtts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'tts_cache')
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR)

function gttsPlugin() {
  return {
    name: 'gtts-middleware',
    configureServer(server) {
      server.middlewares.use('/api/tts', async (req, res) => {
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

        try {
          const audio = await fetchTTS(text, lang)
          writeFileSync(cacheFile, audio)
          res.end(audio)
        } catch (err) {
          res.statusCode = 500
          res.end(`TTS error: ${err.message}`)
        }
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
