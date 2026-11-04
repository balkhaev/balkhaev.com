#!/usr/bin/env bash
# Python packages for scripts/voice.py on a CPU-only CI runner.
set -euo pipefail
sudo apt-get update -qq
sudo apt-get install -y -qq sox libsox-dev > /dev/null
pip install --quiet torch==2.9.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cpu
pip install --quiet qwen-tts==0.1.1
