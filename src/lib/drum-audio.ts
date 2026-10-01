/** A quiet synthesized frame-drum voice, activated only by the sound button. */
export function createDrumAudio() {
  let context: AudioContext | null = null;
  let enabled = false;
  let noise: AudioBuffer | null = null;
  return {
    async dispose() {
      enabled = false;
      if (context) {
        await context.close();
        context = null;
      }
    },
    pulse(strength = 1) {
      if (!(enabled && context?.state === "running")) {
        return;
      }
      const now = context.currentTime;
      // The membrane's low mode and two shorter overtones decay independently.
      for (const [frequency, gain, duration] of [
        [58, 0.12, 0.8],
        [93, 0.045, 0.34],
        [147, 0.022, 0.18],
      ]) {
        if (!(frequency && gain && duration)) {
          continue;
        }
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.frequency.setValueAtTime(frequency * 1.15, now);
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency,
          now + 0.12
        );
        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.exponentialRampToValueAtTime(
          gain * strength,
          now + 0.004
        );
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(envelope).connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + duration + 0.02);
        oscillator.onended = () => {
          oscillator.disconnect();
          envelope.disconnect();
        };
      }
      if (!noise) {
        noise = context.createBuffer(
          1,
          Math.ceil(context.sampleRate * 0.055),
          context.sampleRate
        );
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i += 1) {
          samples[i] = Math.random() * 2 - 1;
        }
      }
      const tap = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      tap.buffer = noise;
      filter.type = "lowpass";
      filter.frequency.value = 1200;
      envelope.gain.setValueAtTime(0.035 * strength, now);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      tap.connect(filter).connect(envelope).connect(context.destination);
      tap.start(now);
      tap.onended = () => {
        tap.disconnect();
        filter.disconnect();
        envelope.disconnect();
      };
    },
    async toggle() {
      try {
        context ??= new AudioContext();
        enabled = !enabled;
        if (enabled) {
          await context.resume();
        } else {
          await context.suspend();
        }
      } catch {
        enabled = false;
      }
      return enabled;
    },
  };
}
