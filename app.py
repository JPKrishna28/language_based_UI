"""TTS microservice — serves /tts endpoint using gTTS. React frontend connects directly to Supabase.

Usage:
    pip install flask flask-cors gTTS python-dotenv
    python app.py
"""
import hashlib
import io
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, request, send_file
from flask_cors import CORS

load_dotenv()

try:
    from gtts import gTTS
except ImportError:
    gTTS = None

TTS_CACHE = Path(__file__).parent / "tts_cache"
TTS_CACHE.mkdir(exist_ok=True)

app = Flask(__name__)
CORS(app)


@app.route("/tts")
def tts():
    if gTTS is None:
        abort(500, description="gTTS not installed. Run: pip install gTTS")
    text = (request.args.get("text") or "").strip()
    lang = (request.args.get("lang") or "hi").strip()
    if not text:
        abort(400, description="missing text")
    if len(text) > 500:
        text = text[:500]

    key = hashlib.sha1(f"{lang}|{text}".encode("utf-8")).hexdigest()
    cache_file = TTS_CACHE / f"{key}.mp3"
    if not cache_file.exists():
        try:
            tts_obj = gTTS(text=text, lang=lang, slow=False)
            buf = io.BytesIO()
            tts_obj.write_to_fp(buf)
            cache_file.write_bytes(buf.getvalue())
        except Exception as exc:
            abort(500, description=f"TTS error: {exc}")
    return send_file(cache_file, mimetype="audio/mpeg")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
