import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import QuestionCard from './components/QuestionCard'

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"'\\|\[\]?<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function numberHints(index) {
  const n = index + 1
  const map = {
    1: ['1', 'one', 'first', 'option 1', 'option one', 'पहला', 'एक'],
    2: ['2', 'two', 'second', 'option 2', 'option two', 'दूसरा', 'दो'],
    3: ['3', 'three', 'third', 'option 3', 'option three', 'तीसरा', 'तीन'],
    4: ['4', 'four', 'fourth', 'option 4', 'option four', 'चौथा', 'चार'],
    5: ['5', 'five', 'fifth', 'option 5', 'option five', 'पांचवा', 'पांच'],
  }
  return map[n] || [String(n), `option ${n}`]
}

function scoreOptionMatch(option, transcript, index) {
  const t = normalizeText(transcript)
  if (!t) return 0

  const labels = [
    normalizeText(option.hindi_option_label),
    normalizeText(option.option_label),
    normalizeText(option.option_value),
  ].filter(Boolean)

  let score = 0
  for (const label of labels) {
    if (t === label) score = Math.max(score, 100)
    if (t.includes(label) || label.includes(t)) score = Math.max(score, 75)

    const lTokens = new Set(label.split(' ').filter(Boolean))
    const tTokens = new Set(t.split(' ').filter(Boolean))
    let overlap = 0
    for (const token of lTokens) {
      if (tTokens.has(token)) overlap += 1
    }
    if (overlap > 0) {
      score = Math.max(score, 20 + overlap * 15)
    }
  }

  for (const hint of numberHints(index)) {
    const h = normalizeText(hint)
    if (h && t.includes(h)) {
      score = Math.max(score, 65)
      break
    }
  }

  return score
}

function findBestOption(options, transcript) {
  let best = null
  let bestScore = 0

  options.forEach((option, index) => {
    const score = scoreOptionMatch(option, transcript, index)
    if (score > bestScore) {
      best = option
      bestScore = score
    }
  })

  if (bestScore < 40) return null
  return { option: best, score: bestScore }
}

export default function App() {
  const [questions, setQuestions] = useState([])
  const [optionsByQid, setOptionsByQid] = useState({})
  const [answersByQid, setAnswersByQid] = useState({})
  const [scales, setScales] = useState([])
  const [selectedScale, setSelectedScale] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lang, setLang] = useState('hi')
  const [playingId, setPlayingId] = useState(null)
  const [listeningQid, setListeningQid] = useState(null)
  const [voiceStatusByQid, setVoiceStatusByQid] = useState({})

  const audioRef = useRef(new Audio())
  const stopFlagRef = useRef(false)
  const recognitionRef = useRef(null)

  useEffect(() => {
    fetchData()
    return () => {
      audioRef.current.pause()
      if (recognitionRef.current) {
        recognitionRef.current.abort()
      }
    }
  }, [])

  async function fetchData() {
    setLoading(true)
    setError(null)

    const [qRes, oRes] = await Promise.all([
      supabase.from('prs_questions').select('*').order('display_order'),
      supabase.from('prs_options').select('*').eq('status', true).order('display_order'),
    ])

    if (qRes.error) { setError(qRes.error.message); setLoading(false); return }
    if (oRes.error) { setError(oRes.error.message); setLoading(false); return }

    const qs = (qRes.data || []).sort((a, b) =>
      (a.scale_id || '').localeCompare(b.scale_id || '') ||
      ((a.display_order || 0) - (b.display_order || 0))
    )

    const byQid = {}
    for (const o of (oRes.data || [])) {
      if (!byQid[o.question_id]) byQid[o.question_id] = []
      byQid[o.question_id].push(o)
    }
    for (const opts of Object.values(byQid)) {
      opts.sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    }

    setQuestions(qs)
    setOptionsByQid(byQid)
    setScales([...new Set(qs.map(q => q.scale_id).filter(Boolean))].sort())
    setLoading(false)
  }

  function stopSpeak() {
    stopFlagRef.current = true
    const audio = audioRef.current
    audio.pause()
    audio.src = ''
    setPlayingId(null)
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
    setListeningQid(null)
  }

  function playUrl(url, id) {
    return new Promise(resolve => {
      const audio = audioRef.current
      setPlayingId(id)
      const cleanup = () => { setPlayingId(null); resolve() }
      audio.onended = cleanup
      audio.onerror = cleanup
      audio.src = url
      audio.play().catch(cleanup)
    })
  }

  async function speakText(id, text) {
    stopSpeak()
    stopFlagRef.current = false
    await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(text)}`, id)
  }

  async function speakAll() {
    stopListening()
    stopSpeak()
    stopFlagRef.current = false
    const filtered = selectedScale ? questions.filter(q => q.scale_id === selectedScale) : questions
    for (const q of filtered) {
      if (stopFlagRef.current) return
      const qText = q.hindi_question_text || q.question_text
      await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(qText)}`, `q-${q.question_id}`)
      for (const o of (optionsByQid[q.question_id] || [])) {
        if (stopFlagRef.current) return
        const oText = o.hindi_option_label || o.option_label
        await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(oText)}`, `o-${o.option_id}`)
      }
    }
  }

  function setAnswer(questionId, optionValue) {
    setAnswersByQid(prev => ({ ...prev, [questionId]: optionValue }))
  }

  function recognitionLanguages(selectedLang) {
    if (selectedLang === 'hi') return ['hi-IN', 'en-IN']
    return ['en-IN', 'en-US']
  }

  // Safari only allows audio playback started from a user gesture. Playing a tiny
  // silent clip synchronously in the click handler marks the shared <audio> element
  // as user-activated so later TTS play() calls (after awaits) are not blocked.
  function unlockAudio() {
    const audio = audioRef.current
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
    audio.play().catch(() => {})
  }

  // Safari never shows a mic prompt for SpeechRecognition.start() once the user
  // gesture has expired, so we must request permission explicitly while still
  // inside the click gesture.
  async function ensureMicPermission() {
    if (!window.isSecureContext) {
      throw Object.assign(new Error('insecure'), { code: 'insecure-context' })
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('unsupported'), { code: 'no-media-devices' })
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(track => track.stop())
  }

  async function readAndSelectByVoice(question, options, opts = {}) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser. Use Chrome/Edge, or Safari 14.1+ with Siri & Dictation enabled.')
      return
    }

    const qid = question.question_id
    stopSpeak()
    stopListening()
    setError(null)

    // Must run synchronously in the click gesture, before any await (Safari).
    unlockAudio()

    setVoiceStatusByQid(prev => ({ ...prev, [qid]: 'Requesting microphone...' }))
    try {
      await ensureMicPermission()
    } catch (err) {
      if (err.code === 'insecure-context') {
        setError('Microphone is blocked on insecure pages. Open the app via https:// or http://localhost (Safari blocks the mic on plain http over an IP address).')
      } else if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setError('Microphone permission was denied. In Safari: Settings > Websites > Microphone (macOS) or Settings app > Safari > Microphone (iOS), then reload.')
      } else if (err.name === 'NotFoundError') {
        setError('No microphone was found on this device.')
      } else {
        setError(`Microphone unavailable: ${err.name || err.message}`)
      }
      setVoiceStatusByQid(prev => ({ ...prev, [qid]: 'Microphone not available' }))
      return
    }

    setVoiceStatusByQid(prev => ({ ...prev, [qid]: 'Reading options...' }))

    const qText = question.hindi_question_text || question.question_text
    await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(qText)}`, `q-${qid}`)

    if (!opts.numericOnly) {
      for (const option of options) {
        const optionText = option.hindi_option_label || option.option_label
        await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(optionText)}`, `o-${option.option_id}`)
      }
    } else {
      setVoiceStatusByQid(prev => ({ ...prev, [qid]: 'Speak option number (e.g. 1) now' }))
    }

    // A short pause helps avoid microphone handoff glitches right after audio playback.
    await new Promise(resolve => setTimeout(resolve, 250))

    const langs = recognitionLanguages(lang)
    let attemptIndex = 0
    let retryAfterEnd = false

    const startRecognitionAttempt = () => {
      const currentLang = langs[Math.min(attemptIndex, langs.length - 1)]
      const recognition = new SpeechRecognition()
      recognitionRef.current = recognition
      recognition.continuous = false
      recognition.interimResults = false
      recognition.maxAlternatives = 5
      recognition.lang = currentLang

      recognition.onstart = () => {
        setListeningQid(qid)
        setVoiceStatusByQid(prev => ({ ...prev, [qid]: `Listening... (${currentLang})` }))
      }

      recognition.onresult = (event) => {
        const transcript = (event.results?.[0]?.[0]?.transcript || '').trim()
        if (opts.numericOnly) {
          const ok = selectBySpokenNumber(qid, transcript)
          if (!ok) {
            setVoiceStatusByQid(prev => ({ ...prev, [qid]: `Heard: "${transcript}" (not a valid option number)` }))
          }
          return
        }

        const best = findBestOption(options, transcript)
        if (best) {
          setAnswer(qid, best.option.option_value)
          const label = best.option.hindi_option_label || best.option.option_label || best.option.option_value
          setVoiceStatusByQid(prev => ({ ...prev, [qid]: `Heard: "${transcript}" -> selected: "${label}"` }))
        } else {
          setVoiceStatusByQid(prev => ({ ...prev, [qid]: `Heard: "${transcript}" (no close option match)` }))
        }
      }

      recognition.onerror = (event) => {
        if (event.error === 'aborted') return

        if (event.error === 'network' && attemptIndex + 1 < langs.length) {
          attemptIndex += 1
          retryAfterEnd = true
          setVoiceStatusByQid(prev => ({
            ...prev,
            [qid]: `Voice network issue. Retrying with ${langs[attemptIndex]}...`,
          }))
          recognition.abort()
          return
        }

        if (event.error === 'network') {
          setVoiceStatusByQid(prev => ({
            ...prev,
            [qid]: 'Voice input error: network. Check internet, allow microphone permission, and use localhost/https.',
          }))
          return
        }

        if (event.error === 'not-allowed') {
          setVoiceStatusByQid(prev => ({
            ...prev,
            [qid]: 'Microphone permission denied. Allow it in browser settings and reload.',
          }))
          return
        }

        if (event.error === 'service-not-allowed') {
          // Safari fires this when Siri & Dictation are turned off at the OS level.
          setVoiceStatusByQid(prev => ({
            ...prev,
            [qid]: 'Speech service unavailable. On Safari, enable Siri or Dictation in system settings, then reload.',
          }))
          return
        }

        setVoiceStatusByQid(prev => ({ ...prev, [qid]: `Voice input error: ${event.error}` }))
      }

      recognition.onend = () => {
        if (retryAfterEnd) {
          retryAfterEnd = false
          startRecognitionAttempt()
          return
        }
        setListeningQid(prev => (prev === qid ? null : prev))
        recognitionRef.current = null
      }

      recognition.start()
    }

    startRecognitionAttempt()
  }

  function selectBySpokenNumber(questionId, spoken) {
    const n = parseInt((spoken || '').match(/\d+/)?.[0], 10)
    if (!n || n <= 0) return false
    const opts = optionsByQid[questionId] || []
    const idx = n - 1
    if (idx < 0 || idx >= opts.length) return false
    setAnswer(questionId, opts[idx].option_value)
    setVoiceStatusByQid(prev => ({ ...prev, [questionId]: `Spoken number: ${n} -> selected option ${n}` }))
    return true
  }

  const filtered = selectedScale
    ? questions.filter(q => q.scale_id === selectedScale)
    : questions

  // Build scale groups preserving sort order
  const groups = []
  let lastScale = null
  for (const q of filtered) {
    if (q.scale_id !== lastScale) {
      groups.push({ scale_id: q.scale_id, disease_id: q.disease_id, questions: [] })
      lastScale = q.scale_id
    }
    groups[groups.length - 1].questions.push(q)
  }

  // Flat index across all groups for display numbering
  let globalIdx = 0

  return (
    <div className="app">
      <h1>PRS Questionnaire</h1>

      <div className="controls">
        <label>
          Scale&nbsp;
          <select value={selectedScale} onChange={e => setSelectedScale(e.target.value)}>
            <option value="">All ({questions.length})</option>
            {scales.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label>
          Voice&nbsp;
          <select value={lang} onChange={e => setLang(e.target.value)}>
            <option value="hi">Hindi</option>
            <option value="en">English</option>
          </select>
        </label>

        <button className="btn-green" onClick={speakAll}>&#9654; Read all</button>
        <button className="btn-gray" onClick={stopSpeak}>&#9632; Stop</button>
      </div>

      {loading && <p className="status">Loading from Supabase&hellip;</p>}
      {error && <p className="status error">Error: {error}</p>}

      {groups.map(group => (
        <div key={group.scale_id || 'no-scale'}>
          <div className="scale-header">
            <strong>Scale:</strong> {group.scale_id}&nbsp;&nbsp;|&nbsp;&nbsp;
            <strong>Disease:</strong> {group.disease_id}
          </div>
          {group.questions.map(q => {
            globalIdx += 1
            return (
              <QuestionCard
                key={q.question_id}
                question={q}
                options={optionsByQid[q.question_id] || []}
                index={globalIdx}
                speakText={speakText}
                playingId={playingId}
                selectedValue={answersByQid[q.question_id] ?? ''}
                onSelectOption={value => setAnswer(q.question_id, value)}
                onReadAndVoiceSelect={(opts) => readAndSelectByVoice(q, optionsByQid[q.question_id] || [], opts)}
                isListening={listeningQid === q.question_id}
                voiceStatus={voiceStatusByQid[q.question_id]}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
