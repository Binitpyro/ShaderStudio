/**
 * Shader Studio — Web Audio DSP Engine
 * Provides real-time FFT frequency spectrum, waveform data,
 * band segmentation (bass/mid/treble), and spectral flux beat detection.
 */

export interface AudioUniforms {
  bass: number
  mid: number
  treble: number
  level: number
  beat: number
}

export type AudioSourceType = "builtin" | "file" | "mic"

export class AudioEngine {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private masterGain: GainNode | null = null
  private sourceNode: AudioBufferSourceNode | MediaStreamAudioSourceNode | null = null
  private micStream: MediaStream | null = null

  private builtinBuffer: AudioBuffer | null = null
  private customBuffer: AudioBuffer | null = null

  private sourceType: AudioSourceType = "builtin"
  private isPlaying = false
  private volume = 0.8
  private gainMultiplier = 1.2
  private smoothing = 0.8

  // FFT analysis buffers (512 bins from 1024 FFT size)
  public readonly fftSize = 1024
  public readonly binCount = 512
  private freqData = new Uint8Array(512)
  private timeData = new Uint8Array(512)
  public readonly textureBuffer = new Uint8Array(512 * 2) // Row 0: Freq, Row 1: Waveform

  // DSP & Beat Detection State
  private lastBassEnergy = 0
  private beatEnergyHistory: number[] = []
  private readonly historyLength = 30
  private beatPulse = 0
  private beatDecayRate = 0.88

  public uniforms: AudioUniforms = {
    bass: 0,
    mid: 0,
    treble: 0,
    level: 0,
    beat: 0,
  }

  constructor() {
    // Lazy initialize on first user gesture
  }

  public getContext(): AudioContext | null {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = this.fftSize
        this.analyser.smoothingTimeConstant = this.smoothing

        this.masterGain = this.ctx.createGain()
        this.masterGain.gain.value = this.volume
        this.masterGain.connect(this.analyser)
        this.analyser.connect(this.ctx.destination)

        this.initProceduralTrack()
      }
    }
    return this.ctx
  }

  /**
   * Generates a 4-bar procedural drum & bass electronic loop in-memory.
   * Eliminates any dependency on external audio assets, network, or CORS.
   */
  private initProceduralTrack() {
    if (!this.ctx) return
    const sampleRate = this.ctx.sampleRate
    const bpm = 124
    const beatDuration = 60 / bpm
    const loopDuration = beatDuration * 16 // 4 bars = 16 beats (~7.74s)
    const totalSamples = Math.floor(sampleRate * loopDuration)

    const buffer = this.ctx.createBuffer(2, totalSamples, sampleRate)
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)

    // Bass notes in MIDI (Am progression: A1, F1, C2, G1)
    const bassNotes = [33, 29, 36, 31]
    const mtof = (note: number) => 440 * Math.pow(2, (note - 69) / 12)

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate
      const currentBeat = (t / beatDuration) % 16
      const barIndex = Math.floor(currentBeat / 4)
      const beatInBar = currentBeat % 4
      const beatFraction = beatInBar % 1

      let sample = 0

      // 1. Kick Drum (Four-on-the-floor on every beat)
      if (beatFraction < 0.35) {
        const kickTime = beatFraction * beatDuration
        const kickPitch = Math.max(45, 160 * Math.exp(-kickTime * 28))
        const kickEnv = Math.exp(-kickTime * 14)
        sample += Math.sin(2 * Math.PI * kickPitch * kickTime) * kickEnv * 0.75
      }

      // 2. Offbeat Hi-Hat & Percussive Sparkle
      const hatFraction = (beatInBar + 0.5) % 1
      if (hatFraction < 0.22) {
        const hatTime = hatFraction * beatDuration
        const noise = (Math.random() * 2 - 1)
        const hatEnv = Math.exp(-hatTime * 38)
        sample += noise * hatEnv * 0.35
      }
      const tickFraction = (currentBeat * 4) % 1
      if (tickFraction < 0.08) {
        sample += (Math.random() * 2 - 1) * Math.exp(-tickFraction * 50) * 0.18
      }

      // 3. Rolling Synthesizer Bassline (16th notes)
      const subPitch = mtof(bassNotes[barIndex])
      const bassEnv = Math.exp(-(t % (beatDuration / 4)) * 9)
      const sawPhase = (t * subPitch) % 1
      const saw = (sawPhase * 2 - 1)
      sample += saw * bassEnv * 0.35

      // 4. Ambient Pad Chords
      const chordRoot = mtof(bassNotes[barIndex] + 24)
      const pad = (
        Math.sin(2 * Math.PI * chordRoot * t) * 0.08 +
        Math.sin(2 * Math.PI * (chordRoot * 1.2) * t) * 0.06 +
        Math.sin(2 * Math.PI * (chordRoot * 1.5) * t) * 0.05
      )
      sample += pad

      // Soft clip limiter
      const limited = Math.tanh(sample * 1.1)
      left[i] = limited
      right[i] = limited
    }

    this.builtinBuffer = buffer
  }

  public async play(): Promise<void> {
    const ctx = this.getContext()
    if (!ctx) return

    if (ctx.state === "suspended") {
      await ctx.resume()
    }

    if (this.isPlaying) return

    if (this.sourceType === "mic") {
      await this.startMicrophone()
      this.isPlaying = true
      return
    }

    const buffer = this.sourceType === "file" && this.customBuffer ? this.customBuffer : this.builtinBuffer
    if (!buffer) return

    this.stopSource()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(this.masterGain!)
    source.start(0)

    this.sourceNode = source
    this.isPlaying = true
  }

  public pause(): void {
    if (this.sourceType === "mic") {
      this.stopMicrophone()
    } else {
      this.stopSource()
    }
    this.isPlaying = false
  }

  public togglePlay(): boolean {
    if (this.isPlaying) {
      this.pause()
    } else {
      this.play()
    }
    return this.isPlaying
  }

  private stopSource(): void {
    if (this.sourceNode) {
      try {
        if ("stop" in this.sourceNode) {
          this.sourceNode.stop()
        }
        this.sourceNode.disconnect()
      } catch {
        // Safe disconnect
      }
      this.sourceNode = null
    }
  }

  public async setSourceType(type: AudioSourceType): Promise<void> {
    const wasPlaying = this.isPlaying
    this.pause()
    this.sourceType = type

    if (wasPlaying) {
      await this.play()
    }
  }

  public getSourceType(): AudioSourceType {
    return this.sourceType
  }

  public getIsPlaying(): boolean {
    return this.isPlaying
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol))
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
    }
  }

  public getVolume(): number {
    return this.volume
  }

  public setGainMultiplier(gain: number): void {
    this.gainMultiplier = Math.max(0.1, Math.min(5.0, gain))
  }

  public getGainMultiplier(): number {
    return this.gainMultiplier
  }

  public setSmoothing(smoothing: number): void {
    this.smoothing = Math.max(0.0, Math.min(0.95, smoothing))
    if (this.analyser) {
      this.analyser.smoothingTimeConstant = this.smoothing
    }
  }

  public getSmoothing(): number {
    return this.smoothing
  }

  public async loadCustomAudioFile(file: File | ArrayBuffer): Promise<boolean> {
    const ctx = this.getContext()
    if (!ctx) return false

    try {
      const arrayBuffer = file instanceof File ? await file.arrayBuffer() : file
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
      this.customBuffer = decoded
      this.sourceType = "file"
      if (this.isPlaying) {
        await this.play()
      }
      return true
    } catch (err) {
      console.error("Failed to decode audio file:", err)
      return false
    }
  }

  public async startMicrophone(): Promise<boolean> {
    const ctx = this.getContext()
    if (!ctx || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return false
    }

    try {
      this.stopMicrophone()
      this.stopSource()

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      this.micStream = stream

      const micSource = ctx.createMediaStreamSource(stream)
      // Connect to analyser but NOT to ctx.destination to prevent feedback loops!
      micSource.connect(this.analyser!)
      this.sourceNode = micSource
      return true
    } catch (err) {
      console.warn("Microphone access denied or unavailable:", err)
      this.sourceType = "builtin"
      return false
    }
  }

  public stopMicrophone(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop())
      this.micStream = null
    }
    this.stopSource()
  }

  /**
   * Per-frame DSP processing.
   * Updates frequency and time domain data, extracts frequency bands,
   * calculates spectral flux beat detection, and packs the 512x2 GPU texture.
   */
  public update(): { textureBuffer: Uint8Array; uniforms: AudioUniforms } {
    if (this.analyser && this.isPlaying) {
      this.analyser.getByteFrequencyData(this.freqData)
      this.analyser.getByteTimeDomainData(this.timeData)
    } else {
      // Gentle decay to zero when stopped
      for (let i = 0; i < 512; i++) {
        this.freqData[i] = Math.floor(this.freqData[i] * 0.9)
        this.timeData[i] = 128 + Math.floor((this.timeData[i] - 128) * 0.9)
      }
    }

    // 1. Pack 512x2 Texture Buffer (Row 0 = Freq, Row 1 = Waveform)
    this.textureBuffer.set(this.freqData, 0)
    this.textureBuffer.set(this.timeData, 512)

    // 2. Frequency Band Integration
    // Valid FFT bins: 256 for fftSize=512 (binWidth ~86.1Hz at 44.1kHz)
    // Bass: bins 1..8 (~86Hz - 688Hz)
    // Mid: bins 9..64 (~775Hz - 5.5kHz)
    // Treble: bins 65..220 (~5.6kHz - 18.9kHz)
    let bassSum = 0
    for (let i = 1; i <= 8; i++) bassSum += this.freqData[i]
    const rawBass = (bassSum / (8 * 255)) * this.gainMultiplier

    let midSum = 0
    for (let i = 9; i <= 64; i++) midSum += this.freqData[i]
    const rawMid = (midSum / ((64 - 9 + 1) * 255)) * this.gainMultiplier

    let trebleSum = 0
    for (let i = 65; i <= 220; i++) trebleSum += this.freqData[i]
    const rawTreble = (trebleSum / ((220 - 65 + 1) * 255)) * this.gainMultiplier * 3.2

    // Overall RMS level from time-domain PCM
    let levelSum = 0
    for (let i = 0; i < 512; i++) {
      const centered = (this.timeData[i] - 128) / 128
      levelSum += centered * centered
    }
    const rawLevel = Math.sqrt(levelSum / 512) * this.gainMultiplier

    // 3. Spectral Flux Beat Detection on Bass Energy
    const currentBassEnergy = rawBass
    const delta = Math.max(0, currentBassEnergy - this.lastBassEnergy)
    this.lastBassEnergy = currentBassEnergy

    this.beatEnergyHistory.push(delta)
    if (this.beatEnergyHistory.length > this.historyLength) {
      this.beatEnergyHistory.shift()
    }

    const avgFlux = this.beatEnergyHistory.reduce((a, b) => a + b, 0) / this.beatEnergyHistory.length
    const variance = this.beatEnergyHistory.reduce((a, b) => a + Math.pow(b - avgFlux, 2), 0) / this.beatEnergyHistory.length
    const threshold = avgFlux + Math.sqrt(variance) * 1.5

    if (delta > threshold && delta > 0.08 && this.beatPulse < 0.25) {
      this.beatPulse = 1.0
    } else {
      this.beatPulse *= this.beatDecayRate
      if (this.beatPulse < 0.01) this.beatPulse = 0
    }

    this.uniforms = {
      bass: Math.min(1.0, rawBass),
      mid: Math.min(1.0, rawMid),
      treble: Math.min(1.0, rawTreble),
      level: Math.min(1.0, rawLevel),
      beat: this.beatPulse,
    }

    return {
      textureBuffer: this.textureBuffer,
      uniforms: this.uniforms,
    }
  }

  public dispose(): void {
    this.stopMicrophone()
    this.stopSource()
    if (this.ctx && this.ctx.state !== "closed") {
      this.ctx.close().catch(() => {})
    }
    this.ctx = null
    this.analyser = null
    this.masterGain = null
    this.builtinBuffer = null
    this.customBuffer = null
    this.isPlaying = false
  }
}

export const audioEngine = new AudioEngine()
