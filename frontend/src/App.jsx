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
    1: ['1', 'one', 'first', 'option 1', 'option one', 'पहला', 'एक', 'पहिला'],
    2: ['2', 'two', 'second', 'option 2', 'option two', 'दूसरा', 'दो', 'दुसरा', 'दोन'],
    3: ['3', 'three', 'third', 'option 3', 'option three', 'तीसरा', 'तीन', 'तिसरा'],
    4: ['4', 'four', 'fourth', 'option 4', 'option four', 'चौथा', 'चार'],
    5: ['5', 'five', 'fifth', 'option 5', 'option five', 'पांचवा', 'पांच', 'पाचवा', 'पाच'],
  }
  return map[n] || [String(n), `option ${n}`]
}

function scoreOptionMatch(option, translatedLabel, transcript, index) {
  const t = normalizeText(transcript)
  if (!t) return 0

  const labels = [
    normalizeText(translatedLabel),
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

// Safari (macOS + iOS) requires SpeechRecognition.start() to be called
// synchronously inside a user gesture — it silently fails after awaits.
const isSafari =
  typeof navigator !== 'undefined' &&
  /safari/i.test(navigator.userAgent) &&
  !/chrome|chromium|crios|edg|android/i.test(navigator.userAgent)

function findBestOption(options, getOptionLabel, transcript) {
  let best = null
  let bestScore = 0

  options.forEach((option, index) => {
    const score = scoreOptionMatch(option, getOptionLabel(option), transcript, index)
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
  // { [lang]: { [question_id]: text } } and { [lang]: { [option_id]: label } }
  const [questionTranslations, setQuestionTranslations] = useState({})
  const [optionTranslations, setOptionTranslations] = useState({})
  const [answersByQid, setAnswersByQid] = useState({})
  const [scales, setScales] = useState([])
  const [selectedScale, setSelectedScale] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lang, setLang] = useState('hi')
  const [playingId, setPlayingId] = useState(null)
  const [listeningQid, setListeningQid] = useState(null)
  const [voiceStatusByQid, setVoiceStatusByQid] = useState({})
  const [voiceMode, setVoiceMode] = useState(false)
  const [activeVoiceQid, setActiveVoiceQid] = useState(null)

  const audioRef = useRef(new Audio())
  const stopFlagRef = useRef(false)
  const recognitionRef = useRef(null)
  const voiceModeRef = useRef(false)
  // Mirror of answersByQid so the async voice-survey loop always sees the
  // latest answers without stale-closure issues.
  const answersRef = useRef({})

  useEffect(() => {
    answersRef.current = answersByQid
  }, [answersByQid])

  useEffect(() => {
    fetchData()
    return () => {
      audioRef.current.pause()
      if (recognitionRef.current) {
        recognitionRef.current.abort()
      }
    }
  }, [])

  // Supabase clamps every response to max_rows (default 1000), regardless of
  // .range() — option translations alone exceed 5000 rows, so page through.
  async function fetchAllRows(table, columns, orderCol, applyFilters) {
    const pageSize = 1000
    const all = []
    for (let from = 0; ; from += pageSize) {
      let query = supabase.from(table).select(columns).order(orderCol).range(from, from + pageSize - 1)
      if (applyFilters) query = applyFilters(query)
      const { data, error } = await query
      if (error) throw new Error(`${table}: ${error.message}`)
      all.push(...(data || []))
      if (!data || data.length < pageSize) return all
    }
  }

  async function fetchData() {
    setLoading(true)
    setError(null)

    let qData, oData, qtData, otData
    try {
      ;[qData, oData, qtData, otData] = await Promise.all([
        fetchAllRows('prs_questions', '*', 'question_id'),
        fetchAllRows('prs_options', '*', 'option_id', q => q.eq('status', true)),
        fetchAllRows('prs_question_translations', 'question_id, lang, question_text', 'question_id'),
        fetchAllRows('prs_option_translations', 'option_id, lang, option_label', 'option_id'),
      ])
    } catch (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const qTrans = {}
    for (const t of qtData) {
      if (!qTrans[t.lang]) qTrans[t.lang] = {}
      qTrans[t.lang][t.question_id] = t.question_text
    }
    const oTrans = {}
    for (const t of otData) {
      if (!oTrans[t.lang]) oTrans[t.lang] = {}
      oTrans[t.lang][t.option_id] = t.option_label
    }

    const qs = qData.sort((a, b) =>
      (a.scale_id || '').localeCompare(b.scale_id || '') ||
      ((a.display_order || 0) - (b.display_order || 0))
    )

    const byQid = {}
    for (const o of oData) {
      if (!byQid[o.question_id]) byQid[o.question_id] = []
      byQid[o.question_id].push(o)
    }
    for (const opts of Object.values(byQid)) {
      opts.sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    }

    setQuestions(qs)
    setOptionsByQid(byQid)
    setQuestionTranslations(qTrans)
    setOptionTranslations(oTrans)
    setScales([...new Set(qs.map(q => q.scale_id).filter(Boolean))].sort())
    setLoading(false)
  }

  // English lives in prs_questions/prs_options; hi/mr come from translation tables.
  function getQuestionText(q) {
    if (lang === 'en') return q.question_text
    return questionTranslations[lang]?.[q.question_id] || q.question_text
  }

  function getOptionLabel(o) {
    if (lang === 'en') return o.option_label
    return optionTranslations[lang]?.[o.option_id] || o.option_label
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
      const qText = getQuestionText(q)
      await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(qText)}`, `q-${q.question_id}`)
      for (const o of (optionsByQid[q.question_id] || [])) {
        if (stopFlagRef.current) return
        const oText = getOptionLabel(o)
        await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(oText)}`, `o-${o.option_id}`)
      }
    }
  }

  function setAnswer(questionId, optionValue) {
    setAnswersByQid(prev => ({ ...prev, [questionId]: optionValue }))
  }

  function recognitionLanguages(selectedLang) {
    if (selectedLang === 'hi') return ['hi-IN', 'en-IN']
    if (selectedLang === 'mr') return ['mr-IN', 'hi-IN', 'en-IN']
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

  // One listen attempt with automatic language fallback. Resolves with:
  //   { transcript }        — user said something
  //   { error, errorLang }  — unrecoverable recognition error
  //   { aborted: true }     — stopped externally
  //   { }                   — recognition ended with no speech
  function listenOnce(qid, langsChain) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    return new Promise(resolve => {
      let attemptIndex = 0
      let retryAfterEnd = false
      let settled = false
      let result = null
      const settle = value => {
        if (!settled) {
          settled = true
          resolve(value)
        }
      }

      const startAttempt = () => {
        const currentLang = langsChain[Math.min(attemptIndex, langsChain.length - 1)]
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
          result = { transcript }
        }

        recognition.onerror = (event) => {
          if (event.error === 'aborted') {
            result = { aborted: true }
            return
          }
          const retriable = event.error === 'network' || event.error === 'language-not-supported'
          if (retriable && attemptIndex + 1 < langsChain.length) {
            attemptIndex += 1
            retryAfterEnd = true
            setVoiceStatusByQid(prev => ({
              ...prev,
              [qid]: event.error === 'network'
                ? `Voice network issue. Retrying with ${langsChain[attemptIndex]}...`
                : `${currentLang} speech not supported here. Retrying with ${langsChain[attemptIndex]}...`,
            }))
            recognition.abort()
            return
          }
          result = { error: event.error, errorLang: currentLang }
        }

        recognition.onend = () => {
          if (retryAfterEnd) {
            retryAfterEnd = false
            startAttempt()
            return
          }
          setListeningQid(prev => (prev === qid ? null : prev))
          recognitionRef.current = null
          settle(result || {})
        }

        recognition.start()
      }

      startAttempt()
    })
  }

  function describeRecognitionError(error, errorLang) {
    if (error === 'network') {
      return 'Voice input error: network. Check internet, allow microphone permission, and use localhost/https.'
    }
    if (error === 'not-allowed') {
      return 'Microphone permission denied. Allow it in browser settings and reload.'
    }
    if (error === 'language-not-supported') {
      return `Speech language ${errorLang} not supported here. On Safari, add it as a Dictation language in system settings, or switch Voice to English.`
    }
    if (error === 'service-not-allowed') {
      // Safari fires this when Siri & Dictation are turned off at the OS level.
      return 'Speech service unavailable. On Safari, enable Siri or Dictation in system settings, then reload.'
    }
    return `Voice input error: ${error}`
  }

  function stopVoiceSurvey() {
    voiceModeRef.current = false
    setVoiceMode(false)
    setActiveVoiceQid(null)
    stopSpeak()
    stopListening()
  }

  // Guided voice survey: reads each question + options aloud, listens for the
  // answer, records it, and moves to the next question automatically.
  // resume=true starts right after the last answered question; otherwise it
  // starts from the top, skipping questions that already have answers.
  async function startVoiceSurvey({ resume = false } = {}) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser. Use Chrome/Edge, or Safari 14.1+ with Siri & Dictation enabled.')
      return
    }

    stopSpeak()
    stopListening()
    setError(null)

    // Must run synchronously in the click gesture, before any await (Safari).
    unlockAudio()

    try {
      await ensureMicPermission()
    } catch (err) {
      if (err.code === 'insecure-context') {
        setError('Microphone is blocked on insecure pages. Open the app via https:// or http://localhost (Safari blocks the mic on plain http over an IP address).')
      } else if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setError('Microphone permission was denied. Allow it in browser settings, then reload.')
      } else if (err.name === 'NotFoundError') {
        setError('No microphone was found on this device.')
      } else {
        setError(`Microphone unavailable: ${err.name || err.message}`)
      }
      return
    }

    const list = selectedScale ? questions.filter(q => q.scale_id === selectedScale) : questions
    if (list.length === 0) return

    let startIdx = 0
    if (resume) {
      let lastAnswered = -1
      list.forEach((q, i) => {
        if (answersRef.current[q.question_id] != null) lastAnswered = i
      })
      startIdx = lastAnswered + 1
      if (startIdx >= list.length) {
        setError('All questions already have answers. Use "Start from beginning" to redo.')
        return
      }
    }

    voiceModeRef.current = true
    setVoiceMode(true)
    stopFlagRef.current = false
    const langsChain = recognitionLanguages(lang)

    for (let i = startIdx; i < list.length; i++) {
      if (!voiceModeRef.current) break
      const q = list[i]
      const qid = q.question_id

      // From-the-beginning runs skip questions already answered.
      if (!resume && answersRef.current[qid] != null) continue

      const options = optionsByQid[qid] || []
      if (options.length === 0) continue

      setActiveVoiceQid(qid)
      document.getElementById(`qcard-${qid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Read the question, then each option.
      const qText = getQuestionText(q)
      await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(qText)}`, `q-${qid}`)
      if (!voiceModeRef.current) break
      for (const option of options) {
        const optionText = getOptionLabel(option)
        await playUrl(`/api/tts?lang=${lang}&text=${encodeURIComponent(optionText)}`, `o-${option.option_id}`)
        if (!voiceModeRef.current) break
      }
      if (!voiceModeRef.current) break

      // Short pause avoids microphone handoff glitches right after playback.
      await new Promise(resolve => setTimeout(resolve, 250))

      // Up to two listen attempts per question, then move on unanswered.
      let answered = false
      for (let attempt = 0; attempt < 2 && !answered; attempt++) {
        if (!voiceModeRef.current) break
        const res = await listenOnce(qid, langsChain)
        if (!voiceModeRef.current || res.aborted) break

        if (res.error) {
          setVoiceStatusByQid(prev => ({ ...prev, [qid]: describeRecognitionError(res.error, res.errorLang) }))
          // Hard errors (mic denied, no service) end the whole survey.
          if (res.error === 'not-allowed' || res.error === 'service-not-allowed') {
            stopVoiceSurvey()
            return
          }
          break
        }

        const transcript = res.transcript || ''
        if (!transcript) {
          setVoiceStatusByQid(prev => ({
            ...prev,
            [qid]: attempt === 0 ? 'No speech heard. Listening again...' : 'No speech heard. Moving to next question.',
          }))
          continue
        }

        const best = findBestOption(options, getOptionLabel, transcript)
        if (best) {
          setAnswer(qid, best.option.option_value)
          const label = getOptionLabel(best.option) || best.option.option_value
          setVoiceStatusByQid(prev => ({ ...prev, [qid]: `Heard: "${transcript}" -> selected: "${label}"` }))
          answered = true
        } else {
          setVoiceStatusByQid(prev => ({
            ...prev,
            [qid]: attempt === 0
              ? `Heard: "${transcript}" (no match). Say the option or its number...`
              : `Heard: "${transcript}" (no match). Moving to next question.`,
          }))
        }
      }

      if (!voiceModeRef.current) break
      // Brief gap before the next question.
      await new Promise(resolve => setTimeout(resolve, 400))
    }

    voiceModeRef.current = false
    setVoiceMode(false)
    setActiveVoiceQid(null)
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

  const answeredCount = filtered.filter(q => answersByQid[q.question_id] != null).length

  // Flat index across all groups for display numbering
  let globalIdx = 0

  return (
    <div className="app">
      <h1>PRS Questionnaire</h1>

      <div className="controls">
        <label>
          Scale&nbsp;
          <select value={selectedScale} onChange={e => setSelectedScale(e.target.value)} disabled={voiceMode}>
            <option value="">All ({questions.length})</option>
            {scales.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label>
          Language&nbsp;
          <select value={lang} onChange={e => setLang(e.target.value)} disabled={voiceMode}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="mr">Marathi</option>
          </select>
        </label>

        <button className="btn-green" onClick={speakAll} disabled={voiceMode}>&#9654; Read all</button>
        <button className="btn-gray" onClick={stopSpeak}>&#9632; Stop</button>
      </div>

      <div className="controls voice-controls">
        {!voiceMode ? (
          <>
            <button className="btn-green" onClick={() => startVoiceSurvey()}>
              &#127908; Answer by Voice (from start)
            </button>
            <button
              className="btn-green"
              onClick={() => startVoiceSurvey({ resume: true })}
              disabled={answeredCount === 0}
            >
              &#127908; Resume from last answered
            </button>
          </>
        ) : (
          <button className="btn-gray" onClick={stopVoiceSurvey}>&#9632; Stop voice survey</button>
        )}
        <span className="voice-progress">
          Answered {answeredCount} / {filtered.length}
          {voiceMode && ' — voice survey running...'}
        </span>
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
                lang={lang}
                getQuestionText={getQuestionText}
                getOptionLabel={getOptionLabel}
                index={globalIdx}
                speakText={speakText}
                playingId={playingId}
                selectedValue={answersByQid[q.question_id] ?? ''}
                onSelectOption={value => setAnswer(q.question_id, value)}
                isListening={listeningQid === q.question_id}
                isActiveVoice={activeVoiceQid === q.question_id}
                voiceStatus={voiceStatusByQid[q.question_id]}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
