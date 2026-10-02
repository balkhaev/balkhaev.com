import { END_RADIUS, START_RADIUS } from "./flight";

export interface FlightAudioFrame {
  /** Artistic continuation beyond the physical model, normalized to 0–1. */
  artisticProgress?: number;
  finished?: boolean;
  playing?: boolean;
  radius: number;
  /** Camera heading in degrees, used only for a small change in stereo bearing. */
  yaw?: number;
}

export interface FlightAudio {
  readonly available: boolean;
  dispose: () => void;
  readonly enabled: boolean;
  setAudible: (audible: boolean) => void;
  /** Call from a user gesture. This is the only method that creates an AudioContext. */
  setEnabled: (enabled: boolean) => Promise<boolean>;
  update: (frame: FlightAudioFrame) => void;
}

interface Tone {
  gain: GainNode;
  oscillator: OscillatorNode;
  pan: StereoPannerNode;
}

interface Air {
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

interface Resonance extends Tone {
  shimmer: GainNode;
}

interface Echo {
  feedback: GainNode;
  filter: BiquadFilterNode;
  send: GainNode;
}

interface AudioGraph {
  air: Air[];
  context: AudioContext;
  echoes: Echo[];
  master: GainNode;
  nodes: AudioNode[];
  resonances: Resonance[];
  sources: AudioScheduledSourceNode[];
  tones: Tone[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const ease = (value: number) => value * value * (3 - 2 * value);

/** Retarget each parameter independently; camera scrubbing never restarts a sound. */
function smooth(
  parameter: AudioParam,
  value: number,
  time: number,
  pace = 0.6
) {
  if (typeof parameter.cancelAndHoldAtTime === "function") {
    parameter.cancelAndHoldAtTime(time);
  } else {
    const held = parameter.value;
    parameter.cancelScheduledValues(time);
    parameter.setValueAtTime(held, time);
  }
  parameter.setTargetAtTime(value, time, pace);
}

function pinkNoise(context: AudioContext) {
  const sampleRate = 22_050;
  const buffer = context.createBuffer(1, sampleRate * 12, sampleRate);
  const samples = buffer.getChannelData(0);
  let slow = 0;
  let medium = 0;
  let fast = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const white = Math.random() * 2 - 1;
    slow = 0.997_65 * slow + 0.099_046 * white;
    medium = 0.963 * medium + 0.296_516_4 * white;
    fast = 0.57 * fast + 1.052_691_3 * white;
    samples[i] = (slow + medium + fast + 0.1848 * white) * 0.14;
  }
  // A short equal-power seam keeps the continuous air from clicking at its loop.
  const seam = Math.floor(sampleRate / 4);
  for (let i = 0; i < seam; i += 1) {
    const phase = (i / seam) * Math.PI * 0.5;
    const end = samples.length - seam + i;
    samples[end] =
      (samples[end] ?? 0) * Math.cos(phase) +
      (samples[i] ?? 0) * Math.sin(phase);
  }
  return buffer;
}

/** Quiet score and filtered stereo air: an artistic accompaniment, not sound in vacuum. */
function createGraph(context: AudioContext): AudioGraph {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const keep = <T extends AudioNode>(node: T) => {
    nodes.push(node);
    return node;
  };
  const start = <T extends AudioScheduledSourceNode>(source: T) => {
    keep(source);
    sources.push(source);
    source.start();
    return source;
  };
  const bus = keep(context.createGain());
  const lowCut = keep(context.createBiquadFilter());
  lowCut.type = "highpass";
  lowCut.frequency.value = 26;
  lowCut.Q.value = 0.5;
  const softener = keep(context.createBiquadFilter());
  softener.type = "lowpass";
  softener.frequency.value = 2300;
  softener.Q.value = 0.5;
  const limiter = keep(context.createDynamicsCompressor());
  limiter.threshold.value = -18;
  limiter.knee.value = 18;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.035;
  limiter.release.value = 0.4;
  const master = keep(context.createGain());
  master.gain.value = 0;
  bus.connect(lowCut).connect(softener).connect(limiter).connect(master);
  master.connect(context.destination);

  // Slightly imperfect harmonic ratios create very slow movement without a pulse.
  const ratios = [1, 1.501, 2.003, 3.008, 4.012];
  const levels = [0.2, 0.09, 0.055, 0.028, 0.012];
  const tones = ratios.map((ratio, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 43 * ratio;
    const gain = keep(context.createGain());
    gain.gain.value = levels[index] ?? 0.01;
    const pan = keep(context.createStereoPanner());
    pan.pan.value = index === 0 ? 0 : (index % 2 ? -1 : 1) * 0.25;
    oscillator.connect(gain).connect(pan).connect(bus);
    start(oscillator);
    return { gain, oscillator, pan };
  });

  // Breathing lives on its own AudioParam, so scene updates cannot flatten it.
  const breath = context.createOscillator();
  breath.frequency.value = 0.073;
  const breathDepth = keep(context.createGain());
  breathDepth.gain.value = 0.065;
  const breathing = keep(context.createGain());
  breathing.gain.value = 0.86;
  breath.connect(breathDepth).connect(breathing.gain);
  lowCut.disconnect();
  lowCut.connect(breathing).connect(softener);
  start(breath);

  const noise = pinkNoise(context);
  const air = [-1, 1].map((side) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.loopStart = 0.25;
    source.playbackRate.value = side < 0 ? 0.81 : 0.93;
    const filter = keep(context.createBiquadFilter());
    filter.type = "bandpass";
    filter.frequency.value = 540;
    filter.Q.value = 0.45;
    const gain = keep(context.createGain());
    gain.gain.value = 0.045;
    const pan = keep(context.createStereoPanner());
    pan.pan.value = side * 0.6;
    source.connect(filter).connect(gain).connect(pan).connect(bus);
    const drift = context.createOscillator();
    drift.frequency.value = side < 0 ? 0.037 : 0.051;
    const driftDepth = keep(context.createGain());
    driftDepth.gain.value = 0.19;
    drift.connect(driftDepth).connect(pan.pan);
    start(drift);
    keep(source);
    sources.push(source);
    source.start(0, side < 0 ? 0 : 4.1);
    return { filter, gain, pan };
  });

  // A suspended just-intonation chord emerges only beyond the model boundary.
  // Its two slow native modulators keep the held scene alive without frame timers.
  const shimmerWaves = [0.031, 0.047].map((frequency) => {
    const wave = context.createOscillator();
    wave.frequency.value = frequency;
    return start(wave);
  });
  const resonances = [1, 1.25, 1.5, 2.5].map((ratio, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 132 * ratio;
    const gain = keep(context.createGain());
    gain.gain.value = 0;
    const shimmer = keep(context.createGain());
    shimmer.gain.value = 0;
    shimmerWaves[index % 2]?.connect(shimmer).connect(gain.gain);
    const pan = keep(context.createStereoPanner());
    pan.pan.value = (index % 2 ? -1 : 1) * 0.38;
    oscillator.connect(gain).connect(pan).connect(bus);
    start(oscillator);
    return { gain, oscillator, pan, shimmer };
  });

  // Two damped, unequal echoes give the harmonics space without a convolution cost.
  const echoes: Echo[] = [];
  for (const [delayTime, bearing] of [
    [0.217, -0.75],
    [0.337, 0.75],
  ]) {
    const send = keep(context.createGain());
    send.gain.value = 0.16;
    const delay = keep(context.createDelay(0.5));
    delay.delayTime.value = delayTime ?? 0.217;
    const filter = keep(context.createBiquadFilter());
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.Q.value = 0.5;
    const feedback = keep(context.createGain());
    feedback.gain.value = 0.24;
    const pan = keep(context.createStereoPanner());
    pan.pan.value = bearing ?? 0;
    bus.connect(send).connect(delay).connect(filter).connect(feedback);
    feedback.connect(delay);
    filter.connect(pan).connect(softener);
    echoes.push({ feedback, filter, send });
  }
  return { air, context, echoes, master, nodes, resonances, sources, tones };
}

function applyFrame(graph: AudioGraph, frame: FlightAudioFrame) {
  const radius = Number.isFinite(frame.radius)
    ? clamp(frame.radius, END_RADIUS, START_RADIUS)
    : START_RADIUS;
  const depth =
    Math.log(START_RADIUS / radius) / Math.log(START_RADIUS / END_RADIUS);
  const pressure = ease(clamp(depth / 0.78, 0, 1));
  const interior = ease(clamp((depth - 0.38) / 0.62, 0, 1));
  const artistic = Number.isFinite(frame.artisticProgress)
    ? clamp(frame.artisticProgress ?? 0, 0, 1)
    : 0;
  const bloom = ease(clamp((artistic - 0.1) / 0.55, 0, 1));
  const distance = ease(clamp((artistic - 0.72) / 0.28, 0, 1));
  const heading =
    Math.sin(
      (((Number.isFinite(frame.yaw) ? (frame.yaw ?? 0) : 0) % 360) * Math.PI) /
        180
    ) * 0.12;
  const now = graph.context.currentTime;
  const root = 43 - depth * 10;
  const ratios = [1, 1.501 - depth * 0.009, 2.003, 3.008, 4.012];
  const levels = [0.2, 0.09, 0.055, 0.028, 0.012];
  for (const [index, tone] of graph.tones.entries()) {
    smooth(tone.oscillator.frequency, root * (ratios[index] ?? 1), now, 1.2);
    const thinning = index > 2 ? 1 - interior * 0.7 : 1 + pressure * 0.15;
    smooth(
      tone.gain.gain,
      (levels[index] ?? 0.01) * thinning * (1 - bloom * 0.36),
      now,
      1.2
    );
    smooth(
      tone.pan.pan,
      index === 0 ? 0 : (index % 2 ? -1 : 1) * 0.25 + heading,
      now
    );
  }
  for (const [index, air] of graph.air.entries()) {
    smooth(
      air.filter.frequency,
      (540 + 300 * pressure - 620 * interior) * (1 - bloom * 0.2),
      now,
      1.4
    );
    smooth(
      air.gain.gain,
      (0.045 + pressure * 0.055) * (1 - interior * 0.78) * (1 - bloom * 0.35),
      now,
      1.1
    );
    smooth(air.pan.pan, (index === 0 ? -1 : 1) * 0.6 + heading, now);
  }
  applyResonances(graph, bloom, distance, heading);
}

function applyResonances(
  graph: AudioGraph,
  bloom: number,
  distance: number,
  heading: number
) {
  const now = graph.context.currentTime;
  const chordRoot = 132 - bloom * 14 - distance * 8;
  const chordRatios = [1, 1.25, 1.5, 2.5];
  const chordLevels = [0.047, 0.032, 0.024, 0.012];
  for (const [index, resonance] of graph.resonances.entries()) {
    const level = (chordLevels[index] ?? 0.012) * bloom * (1 - distance * 0.34);
    smooth(
      resonance.oscillator.frequency,
      chordRoot * (chordRatios[index] ?? 1) * (1 + index * 0.0004),
      now,
      2.2
    );
    smooth(resonance.gain.gain, level, now, 2.1);
    smooth(resonance.shimmer.gain, level * 0.18, now, 2.1);
    smooth(
      resonance.pan.pan,
      (index % 2 ? -1 : 1) * (0.38 + bloom * 0.24) + heading * 0.65,
      now,
      1.8
    );
  }
  for (const echo of graph.echoes) {
    smooth(echo.filter.frequency, 700 + bloom * 450, now, 2);
    smooth(echo.send.gain, 0.16 + bloom * 0.035, now, 2);
    smooth(echo.feedback.gain, 0.24 + bloom * 0.075, now, 2);
  }
}

function destroyGraph(graph: AudioGraph) {
  for (const source of graph.sources) {
    source.stop();
  }
  for (const node of graph.nodes) {
    node.disconnect();
  }
  graph.context.close().catch(() => {
    // Browser teardown may have already closed the audio device.
  });
}

function openGraph(AudioContextType: typeof AudioContext) {
  const context = new AudioContextType();
  try {
    return createGraph(context);
  } catch (error) {
    context.close().catch(() => {
      // Construction can fail after the audio device has already opened.
    });
    throw error;
  }
}

/** No audio device, buffer, oscillator or timer is allocated before explicit enablement. */
export function createFlightAudio(): FlightAudio {
  let graph: AudioGraph | null = null;
  let enabled = false;
  let disposed = false;
  let failed = false;
  let audible = true;
  let pageActive = true;
  let lastUpdate = -1;
  let frame: FlightAudioFrame = { radius: START_RADIUS };
  let suspension: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  const contextType = () =>
    typeof window === "undefined" ? undefined : window.AudioContext;
  const visible = () => typeof document === "undefined" || !document.hidden;
  const clearSuspension = () => {
    if (suspension !== null) {
      clearTimeout(suspension);
      suspension = null;
    }
  };
  const volume = () => {
    if (!(enabled && audible && pageActive && visible())) {
      return 0;
    }
    if (frame.finished) {
      return 0.28 * 0.22;
    }
    return 0.28 * (frame.playing === false ? 0.64 : 1);
  };
  const silence = () => {
    const current = graph;
    if (!current) {
      return;
    }
    smooth(current.master.gain, 0, current.context.currentTime, 0.07);
    clearSuspension();
    suspension = setTimeout(() => {
      suspension = null;
      if (graph === current && volume() === 0) {
        current.context.suspend().catch(() => {
          // The page can disappear while the device is suspending.
        });
      }
    }, 400);
  };
  const restore = async () => {
    const current = graph;
    if (!current || volume() === 0) {
      silence();
      return;
    }
    clearSuspension();
    await current.context.resume();
    if (!disposed && graph === current && volume() > 0) {
      applyFrame(current, frame);
      smooth(current.master.gain, volume(), current.context.currentTime, 0.8);
    }
  };
  const visibility = () => {
    if (visible()) {
      restore().catch(silence);
    } else {
      silence();
    }
  };
  const pagehide = () => {
    pageActive = false;
    clearSuspension();
    if (graph) {
      // A cached page freezes timers immediately; suspension cannot wait for a fade.
      const now = graph.context.currentTime;
      graph.master.gain.cancelScheduledValues(now);
      graph.master.gain.setValueAtTime(0, now);
      graph.context.suspend().catch(() => {
        // Navigation may have already released the audio device.
      });
    }
  };
  const pageshow = () => {
    pageActive = true;
    restore().catch(silence);
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", visibility);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
  }

  return {
    get available() {
      return !(failed || disposed) && Boolean(contextType());
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      enabled = false;
      revision += 1;
      clearSuspension();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", visibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", pagehide);
        window.removeEventListener("pageshow", pageshow);
      }
      if (graph) {
        destroyGraph(graph);
        graph = null;
      }
    },
    get enabled() {
      return enabled;
    },
    setAudible(value) {
      if (disposed || audible === value) {
        return;
      }
      audible = value;
      restore().catch(silence);
    },
    async setEnabled(value) {
      if (disposed || failed) {
        return false;
      }
      revision += 1;
      const request = revision;
      enabled = value;
      if (!value) {
        silence();
        return false;
      }
      const AudioContextType = contextType();
      if (!AudioContextType) {
        enabled = false;
        return false;
      }
      try {
        if (!graph) {
          graph = openGraph(AudioContextType);
        }
        await restore();
        return request === revision && enabled && !disposed;
      } catch {
        if (request === revision) {
          enabled = false;
          failed = true;
          if (graph) {
            destroyGraph(graph);
            graph = null;
          }
        }
        return false;
      }
    },
    update(value) {
      const changedPlayback =
        value.finished !== frame.finished || value.playing !== frame.playing;
      frame = value;
      if (
        !(graph && enabled && audible && pageActive && visible()) ||
        disposed
      ) {
        return;
      }
      const now = graph.context.currentTime;
      if (!changedPlayback && now - lastUpdate < 0.08) {
        return;
      }
      lastUpdate = now;
      applyFrame(graph, frame);
      smooth(graph.master.gain, volume(), now, frame.finished ? 3.5 : 0.8);
    },
  };
}
