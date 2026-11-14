"""A small local server around Chatterbox (MIT). Throwaway lab tool for /lab/voice.

Listens on 127.0.0.1 only. Run with the voice venv:
  .data/voice/venv/bin/python scripts/voice/server.py
Voice files are read only from .data/voice/refs/ by file name; audio is returned to the caller and never written to disk.
"""
import io
import os
import re
import threading
import time
from pathlib import Path

import torch
import torchaudio as ta
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from chatterbox.tts import ChatterboxTTS

ROOT = Path(__file__).resolve().parents[2]
REFS = ROOT / ".data" / "voice" / "refs"
PORT = int(os.environ.get("MARGIN_VOICE_PORT", "8765"))

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"[voice] loading Chatterbox on {device} (the first run downloads the weights)", flush=True)
t0 = time.time()
model = ChatterboxTTS.from_pretrained(device=device)
print(f"[voice] ready in {time.time() - t0:.1f}s, sample rate {model.sr}", flush=True)

lock = threading.Lock()  # one synthesis at a time
app = FastAPI()


class Speak(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    exaggeration: float = Field(0.5, ge=0.25, le=2.0)
    cfg_weight: float = Field(0.5, ge=0.0, le=1.0)
    ref: str | None = None  # a file name inside .data/voice/refs, never a path


@app.get("/health")
def health():
    return {"ok": True, "device": device, "sampleRate": model.sr, "refs": sorted(p.name for p in REFS.glob("*") if p.suffix.lower() in {".wav", ".mp3", ".flac", ".m4a"})}


@app.post("/speak")
def speak(req: Speak):
    prompt = None
    if req.ref:
        if not re.fullmatch(r"[\w .\-]+", req.ref) or "/" in req.ref:
            raise HTTPException(400, "A reference is a file name, not a path.")
        path = REFS / req.ref
        if not path.is_file():
            raise HTTPException(404, f"No voice file named {req.ref} in .data/voice/refs.")
        prompt = str(path)
    started = time.time()
    with lock:
        wav = model.generate(req.text, audio_prompt_path=prompt, exaggeration=req.exaggeration, cfg_weight=req.cfg_weight)
    took = time.time() - started
    buf = io.BytesIO()
    ta.save(buf, wav.cpu(), model.sr, format="wav")
    seconds = wav.shape[-1] / model.sr
    return Response(buf.getvalue(), media_type="audio/wav", headers={"X-Synth-Seconds": f"{took:.2f}", "X-Audio-Seconds": f"{seconds:.2f}"})


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
