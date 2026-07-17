export default function QuestionCard({
  question,
  options,
  lang,
  getQuestionText,
  getOptionLabel,
  index,
  speakText,
  playingId,
  selectedValue,
  onSelectOption,
  onReadAndVoiceSelect,
  isListening,
  voiceStatus,
}) {
  const qText = getQuestionText(question)
  const qSpeakId = `q-${question.question_id}`
  const showEnglishSub = lang !== 'en' && qText !== question.question_text

  return (
    <div className="question-card">
      <div className="question-title">
        <span className="q-num">{index}.</span>
        <span className="q-hi">{qText}</span>
        <button
          className={`speak-btn${playingId === qSpeakId ? ' playing' : ''}`}
          onClick={() => speakText(qSpeakId, qText)}
        >
          &#128266;
        </button>
        <button
          className={`voice-btn${isListening ? ' listening' : ''}`}
          onClick={onReadAndVoiceSelect}
          type="button"
        >
          {isListening ? 'Listening...' : 'Read + Answer by Voice'}
        </button>
        <button
          className="voice-btn"
          onClick={() => {
            // trigger numeric-only listen fallback
            if (typeof onReadAndVoiceSelect === 'function') onReadAndVoiceSelect({ numericOnly: true })
          }}
          type="button"
        >
          Speak option number
        </button>
      </div>
      {showEnglishSub && <div className="question-sub">{question.question_text}</div>}
      {voiceStatus && <div className="voice-status">{voiceStatus}</div>}

      <div className="options">
        {options.length === 0 ? (
          <em>No options</em>
        ) : (
          options.map(o => {
            const oText = getOptionLabel(o)
            const oSpeakId = `o-${o.option_id}`
            const isSelected = String(selectedValue) === String(o.option_value)
            return (
              <label key={o.option_id} className={`option-row${isSelected ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name={`q_${question.question_id}`}
                  value={o.option_value}
                  checked={isSelected}
                  onChange={() => onSelectOption(o.option_value)}
                />
                <span className="opt-hi">{oText}</span>
                <span className="option-meta">(pts: {o.points})</span>
                <button
                  className={`speak-btn${playingId === oSpeakId ? ' playing' : ''}`}
                  onClick={e => { e.preventDefault(); speakText(oSpeakId, oText) }}
                >
                  &#128266;
                </button>
              </label>
            )
          })
        )}
      </div>

      <div className="question-meta">
        ID: {question.question_id} &nbsp;|&nbsp; type: {question.answer_type}
        {question.is_required && <span> &nbsp;|&nbsp; required</span>}
      </div>
    </div>
  )
}
