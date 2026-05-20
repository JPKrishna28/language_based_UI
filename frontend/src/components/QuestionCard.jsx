export default function QuestionCard({ question, options, index, speakText, playingId }) {
  const qText = question.hindi_question_text || question.question_text
  const qSpeakId = `q-${question.question_id}`

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
      </div>
      <div className="question-sub">{question.question_text}</div>

      <div className="options">
        {options.length === 0 ? (
          <em>No options</em>
        ) : (
          options.map(o => {
            const oText = o.hindi_option_label || o.option_label
            const oSpeakId = `o-${o.option_id}`
            return (
              <label key={o.option_id} className="option-row">
                <input
                  type="radio"
                  name={`q_${question.question_id}`}
                  value={o.option_value}
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
