export class PaperAudio {
  private context?: AudioContext
  private master?: GainNode
  private noise?: AudioBuffer
  private friction?: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }
  private lastRip = 0
  private lastCrackle = 0
  enabled = false

  async setEnabled(enabled: boolean) {
    if (enabled && !this.context) {
      const context = new AudioContext()
      this.context = context
      const master = context.createGain()
      this.master = master
      master.gain.value = 0
      master.connect(context.destination)
      const noise = context.createBuffer(1, Math.round(context.sampleRate * 1.1), context.sampleRate)
      const samples = noise.getChannelData(0)
      let pink = 0
      for (let i = 0; i < samples.length; i++) {
        const white = Math.random() * 2 - 1
        pink = pink * 0.94 + white * 0.06
        samples[i] = pink * 0.83 + white * 0.46
      }
      this.noise = noise
      const source = context.createBufferSource()
      source.buffer = noise
      source.loop = true
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 440
      const gain = context.createGain()
      gain.gain.value = 0
      source.connect(filter).connect(gain).connect(master)
      source.start()
      this.friction = { source, filter, gain }
    }
    if (!this.context || !this.master) return
    if (enabled) await this.context.resume()
    this.enabled = enabled
    this.master.gain.setTargetAtTime(enabled ? 0.72 : 0, this.context.currentTime, 0.025)
    if (!enabled) this.slide(0)
  }

  slide(speed: number) {
    const context = this.context
    if (!context || !this.friction) return
    const velocity = Math.min(1, speed / 26)
    const now = context.currentTime
    const { filter, gain } = this.friction
    filter.frequency.setTargetAtTime(350 + velocity * 600, now, 0.04)
    gain.gain.setTargetAtTime(this.enabled ? velocity * 0.35 : 0, now, 0.045)
  }

  private burst(time: number, frequency: number, gainValue: number, duration: number, q: number) {
    const context = this.context
    if (!context || !this.noise || !this.master) return
    const noise = context.createBufferSource()
    noise.buffer = this.noise
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    filter.Q.value = q
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0.0001, time)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), time + 0.002)
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration)
    noise.connect(filter).connect(envelope).connect(this.master)
    noise.start(time, Math.random() * 0.6)
    noise.stop(time + duration + 0.005)
  }

  rip(speed: number, cells: number) {
    if (!this.enabled || !this.context || !cells) return
    const now = this.context.currentTime
    if (now - this.lastRip < 0.022) return
    this.lastRip = now
    const velocity = Math.min(1, speed / 48)
    const snaps = Math.min(10, Math.max(2, Math.ceil(cells / 2.5)))
    for (let i = 0; i < snaps; i++) {
      this.burst(now + i * (0.0036 - velocity * 0.0014) + Math.random() * 0.003,
        1600 + velocity * 2150 + Math.random() * 1050, 0.12 + velocity * 0.23, 0.022 + Math.random() * 0.025, 0.75 + Math.random() * 1.5)
    }
  }

  crumple(unfolding: boolean) {
    if (!this.enabled || !this.context) return
    const time = this.context.currentTime
    const count = unfolding ? 19 : 30
    for (let i = 0; i < count; i++) {
      const progress = i / count
      const pressure = Math.sin(Math.PI * (0.08 + progress * 0.88))
      this.burst(time + progress ** (unfolding ? 0.72 : 1.45) * 0.64 + Math.random() * 0.038,
        1250 + Math.random() * 5270, pressure * (0.11 + Math.random() * 0.36), 0.019 + Math.random() * 0.077, 3.2 + Math.random() * 8)
    }
  }

  crackle(speed: number) {
    if (!this.enabled || !this.context || speed < 7) return
    const now = this.context.currentTime
    if (now - this.lastCrackle < 0.056) return
    this.lastCrackle = now
    this.burst(now, 2100 + Math.random() * 3600, Math.min(0.23, speed * 0.009), 0.035, 4)
  }

  stamp() {
    const context = this.context
    const master = this.master
    if (!this.enabled || !context || !master) return
    const now = context.currentTime
    const thump = context.createOscillator()
    thump.frequency.setValueAtTime(93, now)
    thump.frequency.exponentialRampToValueAtTime(56, now + 0.08)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.44, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.115)
    thump.connect(gain).connect(master)
    thump.start(now)
    thump.stop(now + 0.12)
    this.burst(now, 2300, 0.15, 0.046, 1.5)
  }

  recordAudio() {
    const context = this.context
    const master = this.master
    if (!this.enabled || !context || !master) return undefined
    const output = context.createMediaStreamDestination()
    master.connect(output)
    return { stream: output.stream, disconnect: () => master.disconnect(output) }
  }

  dispose() {
    this.friction?.source.stop()
    void this.context?.close()
  }
}
