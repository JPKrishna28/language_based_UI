// Direct Google Translate TTS fetch. Replaces node-gtts, whose hardcoded
// language table predates Marathi ('mr') support and throws for it.
// The endpoint caps text at ~200 chars per request, so long text is split
// into chunks and the resulting MP3 buffers are concatenated.

const MAX_CHUNK = 180

function splitText(text) {
  const chunks = []
  let rest = text.trim()
  while (rest.length > MAX_CHUNK) {
    // Prefer sentence/clause boundaries, then spaces, then hard cut.
    const slice = rest.slice(0, MAX_CHUNK)
    let cut = Math.max(
      slice.lastIndexOf('।'),
      slice.lastIndexOf('.'),
      slice.lastIndexOf(','),
      slice.lastIndexOf('?'),
    )
    if (cut < MAX_CHUNK / 2) cut = slice.lastIndexOf(' ')
    if (cut <= 0) cut = MAX_CHUNK
    chunks.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

export async function fetchTTS(text, lang) {
  const chunks = splitText(text)
  const buffers = []
  for (let i = 0; i < chunks.length; i++) {
    const url =
      'https://translate.google.com/translate_tts' +
      `?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}` +
      `&q=${encodeURIComponent(chunks[i])}` +
      `&textlen=${chunks[i].length}&idx=${i}&total=${chunks.length}`
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://translate.google.com/',
      },
    })
    if (!resp.ok) {
      throw new Error(`Google TTS ${resp.status} for lang=${lang}`)
    }
    buffers.push(Buffer.from(await resp.arrayBuffer()))
  }
  return Buffer.concat(buffers)
}
