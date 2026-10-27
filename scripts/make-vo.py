#!/usr/bin/env python3
"""Voice the prologue offline with Kokoro TTS: one mp3 per shot in public/assets/prologue/vo/.

Reads the lines from public/assets/prologue/prologue.json, so re-run it after editing the script.
Setup (once, ~350 MB):
    python3 -m venv ~/.cache/nexus-tts/venv
    ~/.cache/nexus-tts/venv/bin/pip install kokoro-onnx soundfile
    curl -L -o ~/.cache/nexus-tts/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    curl -L -o ~/.cache/nexus-tts/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
Run:
    ~/.cache/nexus-tts/venv/bin/python scripts/make-vo.py [--voice bm_george] [--speed 0.86] [--only 03]
Needs ffmpeg on PATH (for the room tone, loudness and mp3 encoding).
"""
import argparse, json, os, subprocess, tempfile
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.expanduser(os.environ.get('NEXUS_TTS_DIR', '~/.cache/nexus-tts'))
PRO = os.path.join(ROOT, 'public', 'assets', 'prologue')

ap = argparse.ArgumentParser()
ap.add_argument('--voice', default='bm_george')   # deep, weary British narrator; try bm_lewis, am_onyx, bf_emma
ap.add_argument('--speed', type=float, default=0.86)
ap.add_argument('--only', default=None, help='voice just this shot id, e.g. 03')
args = ap.parse_args()

kokoro = Kokoro(os.path.join(CACHE, 'kokoro-v1.0.onnx'), os.path.join(CACHE, 'voices-v1.0.bin'))
shots = json.load(open(os.path.join(PRO, 'prologue.json'), encoding='utf-8'))['shots']
os.makedirs(os.path.join(PRO, 'vo'), exist_ok=True)

def silence(sec, sr):
    return np.zeros(int(sec * sr), dtype=np.float32)

for shot in shots:
    if args.only and shot['id'] != args.only:
        continue
    parts, sr = [], 24000
    for i, line in enumerate(shot['lines']):
        text = line.replace('…', '...').strip()
        audio, sr = kokoro.create(text.strip('. ') if text.startswith('...') else text, voice=args.voice, speed=args.speed, lang='en-gb')
        if i:  # the direction: a heavy breath between lines, longer after a trailing ellipsis
            parts.append(silence(1.25 if shot['lines'][i - 1].endswith('…') else 0.75, sr))
        parts.append(audio.astype(np.float32))
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'raw.wav')
        sf.write(wav, np.concatenate(parts), sr)
        out = os.path.join(PRO, 'vo', f"{shot['id']}.mp3")
        # a touch of warmth and a large dark room, then broadcast loudness; trims leading silence
        fx = ('silenceremove=start_periods=1:start_threshold=-50dB,'
              'lowshelf=g=3:f=180,highshelf=g=-3:f=7000,'
              'aecho=0.8:0.55:70|130:0.18|0.10,'
              'apad=pad_dur=0.6,loudnorm=I=-17:TP=-1.5:LRA=9')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', fx, '-ar', '44100', '-ac', '1', '-b:a', '128k', out], check=True)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout)
    print(f"{shot['id']}.mp3  {dur:5.1f}s  {' / '.join(shot['lines'])}")
