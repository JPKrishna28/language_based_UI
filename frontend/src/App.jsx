import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import QuestionCard from './components/QuestionCard'

export default function App() {
  const [questions, setQuestions] = useState([])
  const [optionsByQid, setOptionsByQid] = useState({})
  const [scales, setScales] = useState([])
  const [selectedScale, setSelectedScale] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lang, setLang] = useState('hi')
  const [playingId, setPlayingId] = useState(null)

  const audioRef = useRef(new Audio())
  const stopFlagRef = useRef(false)

  useEffect(() => {
    fetchData()
    return () => { audioRef.current.pause() }
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
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
