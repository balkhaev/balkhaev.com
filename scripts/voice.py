"""Voiceover for the post videos, called by scripts/video.ts.

    python3 scripts/voice.py design spec.json
        spec: {language, instruct, reference, out}
        Makes the narrator's reference recording with Qwen3-TTS VoiceDesign.

    python3 scripts/voice.py speak spec.json
        spec: {language, ref_audio, ref_text, lines: [...], out_dir}
        Speaks every line in the reference voice with the Qwen3-TTS Base
        model and writes out_dir/<n>.wav (one per line) and
        out_dir/durations.json (seconds per line).

Runs on CPU (GitHub runners); the models come from Hugging Face.
"""

import json
import os
import re
import sys

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

DESIGN_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
SENTENCE = re.compile(r"(?<=[.!?…])\s+")
# Pause between sentences of one line, seconds.
GAP = 0.12
# Normal speech is 10-20 characters a second; outside these bounds the model
# has skipped text or started babbling, so the sentence is generated again.
MIN_CPS, MAX_CPS = 6.0, 32.0
# Too short to judge: a word or two is spoken at its own pace.
SHORT = 20
ATTEMPTS = 4

torch.set_num_threads(os.cpu_count() or 4)


def load(name):
    return Qwen3TTSModel.from_pretrained(
        name, device_map="cpu", dtype=torch.float32
    )


def trim(wav, sr, threshold=0.01, pad=0.05):
    """Cuts the silence around a clip, keeping a short margin."""
    loud = np.flatnonzero(np.abs(wav) > threshold)
    if loud.size == 0:
        return wav
    margin = int(pad * sr)
    return wav[max(0, loud[0] - margin) : loud[-1] + margin]


def design(spec):
    model = load(DESIGN_MODEL)
    torch.manual_seed(7)
    wavs, sr = model.generate_voice_design(
        text=spec["reference"],
        language=spec["language"],
        instruct=spec["instruct"],
    )
    sf.write(spec["out"], trim(wavs[0], sr), sr)
    print(f"reference: {len(wavs[0]) / sr:.1f}s -> {spec['out']}")


def speak(spec):
    model = load(BASE_MODEL)
    prompt = model.create_voice_clone_prompt(
        ref_audio=spec["ref_audio"], ref_text=spec["ref_text"]
    )
    language = spec["language"]
    out_dir = spec["out_dir"]
    os.makedirs(out_dir, exist_ok=True)

    def say(sentence, index):
        for attempt in range(ATTEMPTS):
            torch.manual_seed(1000 * index + attempt)
            wavs, sr = model.generate_voice_clone(
                text=sentence,
                language=language,
                voice_clone_prompt=prompt,
                max_new_tokens=1500,
            )
            wav = trim(wavs[0], sr)
            cps = len(sentence) / max(len(wav) / sr, 0.01)
            if len(sentence) < SHORT or MIN_CPS <= cps <= MAX_CPS:
                return wav, sr
            print(f"  retry ({cps:.1f} chars/s): {sentence}")
        return wav, sr

    durations = []
    for index, line in enumerate(spec["lines"]):
        parts = []
        sr = 24000
        for number, sentence in enumerate(SENTENCE.split(line.strip())):
            if not sentence:
                continue
            wav, sr = say(sentence, index * 100 + number)
            if parts:
                parts.append(np.zeros(int(GAP * sr), dtype=np.float32))
            parts.append(wav.astype(np.float32))
        audio = np.concatenate(parts) if parts else np.zeros(sr // 2)
        sf.write(os.path.join(out_dir, f"{index}.wav"), audio, sr)
        durations.append(round(len(audio) / sr, 2))
        print(f"line {index + 1}: {durations[-1]}s")
    with open(os.path.join(out_dir, "durations.json"), "w") as file:
        json.dump(durations, file)


if __name__ == "__main__":
    command, path = sys.argv[1], sys.argv[2]
    with open(path) as file:
        spec = json.load(file)
    {"design": design, "speak": speak}[command](spec)
