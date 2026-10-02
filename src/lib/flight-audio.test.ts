import { expect, test } from "bun:test";
import { createFlightAudio } from "./flight-audio";

function mockParameter() {
  return {
    cancelAndHoldAtTime() {
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
    setTargetAtTime(value: number) {
      this.value = value;
    },
    setValueAtTime(value: number) {
      this.value = value;
    },
    value: 0,
  };
}

class MockContext {
  closed = 0;
  currentTime = 0;
  destination = {};
  master: ReturnType<typeof mockParameter> | null = null;
  oscillators: ReturnType<MockContext["createGain"]>[] = [];
  resumed = 0;
  suspended = 0;

  close() {
    this.closed += 1;
    return Promise.resolve();
  }

  createBiquadFilter = this.createGain;

  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }

  createBufferSource = this.createGain;
  createDelay = this.createGain;
  createDynamicsCompressor = this.createGain;

  createGain() {
    const context = this;
    return {
      attack: mockParameter(),
      connect(target: unknown) {
        this.connections.push(target);
        if (target === context.destination) {
          context.master = this.gain;
        }
        return target;
      },
      connections: [] as unknown[],
      delayTime: mockParameter(),
      disconnect() {
        // This lifecycle stub has no hardware graph to disconnect.
      },
      frequency: mockParameter(),
      gain: mockParameter(),
      knee: mockParameter(),
      pan: mockParameter(),
      playbackRate: mockParameter(),
      Q: mockParameter(),
      ratio: mockParameter(),
      release: mockParameter(),
      start() {
        // Sources are intentionally silent in the lifecycle test.
      },
      stop() {
        // Sources are intentionally silent in the lifecycle test.
      },
      threshold: mockParameter(),
    };
  }

  createOscillator() {
    const oscillator = this.createGain();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createStereoPanner = this.createGain;

  resume() {
    this.resumed += 1;
    return Promise.resolve();
  }

  suspend() {
    this.suspended += 1;
    return Promise.resolve();
  }
}

async function withAudioContext(
  context: unknown,
  exercise: (browser: EventTarget) => Promise<void>
) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const browser = Object.assign(new EventTarget(), { AudioContext: context });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  try {
    await exercise(browser);
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "window", previous);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

function oscillatorGain(source: ReturnType<MockContext["createGain"]>) {
  const [destination] = source.connections;
  if (
    !(destination && typeof destination === "object" && "gain" in destination)
  ) {
    throw new Error("Oscillator has no gain envelope");
  }
  return (destination.gain as ReturnType<typeof mockParameter>).value;
}

test("the imagined interior gradually opens its harmonics and retains a quiet endpoint", async () => {
  let device: MockContext | undefined;
  class InteriorContext extends MockContext {
    constructor() {
      super();
      device = this;
    }
  }
  await withAudioContext(InteriorContext, async () => {
    const audio = createFlightAudio();
    audio.update({ artisticProgress: 0, radius: 0.02 });
    expect(await audio.setEnabled(true)).toBe(true);
    const context = device;
    if (!context) {
      throw new Error("Audio device was not created");
    }
    const upperVoice = context.oscillators.find(
      (source) => source.frequency.value > 250
    );
    if (!upperVoice) {
      throw new Error("Interior chord has no upper harmonic");
    }
    expect(oscillatorGain(upperVoice)).toBe(0);
    context.currentTime = 1;
    audio.update({ artisticProgress: 0.25, radius: 0.02 });
    const emerging = oscillatorGain(upperVoice);
    expect(emerging).toBeGreaterThan(0);
    context.currentTime = 2;
    audio.update({ artisticProgress: 0.7, radius: 0.02 });
    const opened = oscillatorGain(upperVoice);
    expect(opened).toBeGreaterThan(emerging);
    context.currentTime = 3;
    audio.update({ artisticProgress: 1, finished: true, radius: 0.02 });
    expect(oscillatorGain(upperVoice)).toBeGreaterThan(0);
    expect(oscillatorGain(upperVoice)).toBeLessThan(opened);
    expect(context.master?.value).toBeGreaterThan(0);
    expect(context.master?.value).toBeLessThan(0.1);
    // Seeking back closes the imagined layer without rebuilding the device.
    context.currentTime = 4;
    audio.update({ artisticProgress: 0, finished: false, radius: 0.02 });
    expect(oscillatorGain(upperVoice)).toBe(0);
    expect(context.resumed).toBe(1);
    audio.dispose();
  });
});

test("invalid continuation inputs and extreme camera headings stay finite and silent outside the layer", async () => {
  let device: MockContext | undefined;
  class FiniteContext extends MockContext {
    constructor() {
      super();
      device = this;
    }
  }
  await withAudioContext(FiniteContext, async () => {
    const audio = createFlightAudio();
    expect(await audio.setEnabled(true)).toBe(true);
    const context = device;
    if (!context) {
      throw new Error("Audio device was not created");
    }
    for (const artisticProgress of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -10,
      10,
    ]) {
      context.currentTime += 1;
      audio.update({
        artisticProgress,
        radius: Number.NaN,
        yaw: Number.MAX_VALUE,
      });
      for (const source of context.oscillators) {
        expect(Number.isFinite(source.frequency.value)).toBe(true);
        for (const destination of source.connections) {
          if (
            destination &&
            typeof destination === "object" &&
            "gain" in destination
          ) {
            expect(
              Number.isFinite(
                (destination.gain as ReturnType<typeof mockParameter>).value
              )
            ).toBe(true);
          }
        }
      }
    }
    audio.dispose();
  });
});

test("the soundscape never opens an audio device before explicit enablement", async () => {
  let devices = 0;
  class BlockedContext {
    constructor() {
      devices += 1;
      throw new Error("Audio device unavailable");
    }
  }
  await withAudioContext(BlockedContext, async () => {
    const audio = createFlightAudio();
    expect(audio.available).toBe(true);
    audio.update({ radius: 1, yaw: 180 });
    audio.setAudible(false);
    audio.setAudible(true);
    expect(await audio.setEnabled(false)).toBe(false);
    expect(audio.enabled).toBe(false);
    expect(devices).toBe(0);

    expect(await audio.setEnabled(true)).toBe(false);
    expect(devices).toBe(1);
    expect(audio.enabled).toBe(false);
    expect(audio.available).toBe(false);
    expect(await audio.setEnabled(true)).toBe(false);
    expect(devices).toBe(1);
    audio.dispose();
    audio.dispose();
  });
});

test("a partial audio-graph failure closes the already opened device", async () => {
  let closed = 0;
  class PartialContext {
    close() {
      closed += 1;
      return Promise.resolve();
    }

    createGain() {
      throw new Error("Audio nodes unavailable");
    }
  }
  await withAudioContext(PartialContext, async () => {
    const audio = createFlightAudio();
    expect(await audio.setEnabled(true)).toBe(false);
    expect(closed).toBe(1);
    expect(audio.enabled).toBe(false);
    expect(audio.available).toBe(false);
    audio.update({ finished: true, radius: 0.02 });
    audio.dispose();
    expect(closed).toBe(1);
  });
});

test("an unsupported browser retains the flight without audio or rejected promises", async () => {
  await withAudioContext(undefined, async () => {
    const audio = createFlightAudio();
    expect(audio.available).toBe(false);
    expect(await audio.setEnabled(true)).toBe(false);
    expect(audio.enabled).toBe(false);
    audio.update({ radius: Number.NaN });
    audio.dispose();
    expect(await audio.setEnabled(true)).toBe(false);
  });
});

test("page caching suspends immediately, preserves the preference, and respects scene availability", async () => {
  const devices: MockContext[] = [];
  class CachedContext extends MockContext {
    constructor() {
      super();
      devices.push(this);
    }
  }
  await withAudioContext(CachedContext, async (browser) => {
    const audio = createFlightAudio();
    expect(await audio.setEnabled(true)).toBe(true);
    const [context] = devices;
    if (!context) {
      throw new Error("Audio device was not created");
    }
    expect(context.master?.value).toBe(0.28);
    audio.update({ finished: false, playing: true, radius: 12.5 });
    // Static reduced-motion frames can change playback without advancing audio time.
    audio.update({ finished: true, playing: false, radius: 0.02 });
    expect(context.master?.value).toBeCloseTo(0.28 * 0.22);
    audio.update({ finished: false, playing: false, radius: 1 });
    expect(context.master?.value).toBeCloseTo(0.28 * 0.64);
    audio.update({ finished: false, playing: true, radius: 12.5 });
    browser.dispatchEvent(new Event("pagehide"));
    expect(context.master?.value).toBe(0);
    expect(context.suspended).toBe(1);
    expect(context.closed).toBe(0);
    expect(audio.enabled).toBe(true);

    browser.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();
    expect(context.resumed).toBe(2);
    expect(context.master?.value).toBe(0.28);

    // An unavailable WebGL scene must stay silent when the page returns.
    audio.setAudible(false);
    browser.dispatchEvent(new Event("pagehide"));
    browser.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();
    expect(context.resumed).toBe(2);
    expect(context.master?.value).toBe(0);
    audio.setAudible(true);
    await Promise.resolve();
    expect(context.resumed).toBe(3);
    expect(context.master?.value).toBe(0.28);

    audio.dispose();
    expect(context.closed).toBe(1);
    browser.dispatchEvent(new Event("pageshow"));
    expect(context.resumed).toBe(3);
  });
});
