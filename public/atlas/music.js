// Optional background music for the Atlas. Off by default (browsers only allow sound after a click, and it is optional anyway).
//
// Two sources, easy to swap:
//   1. Your own files: list them in public/atlas/audio/tracks.json (see the README next to it). If the list has tracks, they play in order, looping.
//      A single track can also be tried without editing anything: ?track=URL on the Atlas address.
//   2. Otherwise a tune is composed live in the browser: a bright, staccato waltz ("tiddlywink" music in the Ayn Rand sense: light, tuneful,
//      operetta / ballroom style) played by a music-box-like synthesizer. It is original (a few lines of code below, no recording),
//      so it carries no copyright or download. Change KEYS, PATTERNS, BPM or the voices below to taste.
//
// composeWaltz() is pure (no browser objects), so it is unit-tested in node.

export const BPM = 172;                                            // quarter notes per minute, 3 to a bar
export const KEYS = [60, 65, 67, 62];                              // tonic (MIDI note) of each 16-bar cycle: C, F, G, D major, then round again
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
// chord of each bar as [scale degree of the root (0 = I), kind]; two 8-bar halves ending on a cadence
const FORM = [[0, 'M'], [3, 'M'], [4, '7'], [0, 'M'], [0, 'M'], [5, 'm'], [4, '7'], [0, 'M'],
  [3, 'M'], [0, 'M'], [4, '7'], [0, 'M'], [1, 'm'], [4, '7'], [4, '7'], [0, 'M']];
// rhythms for the melody of one bar: [start beat, length in beats]
const PATTERNS = [[[0, 1], [1, 1], [2, 1]], [[0, 1.5], [1.5, 0.5], [2, 1]], [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1]], [[0, 2], [2, 1]], [[0, 1], [1, 1], [2, 0.5], [2.5, 0.5]]];

function prng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const scaleNote = (tonic, deg) => tonic + MAJOR[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);   // scale degree (may be negative or above 6) -> MIDI

/** One 16-bar cycle in the key of `tonic`. Returns { beats, events: [{ beat, dur, midi, voice: 'mel' | 'chord' | 'bass', vel }] }. */
export function composeWaltz(seed, tonic = 60) {
  const rnd = prng(seed), events = [];
  let deg = 7 + 4;                                                  // the melody starts on the 5th, an octave up
  FORM.forEach(([root, kind], bar) => {
    const b0 = bar * 3, last = bar === FORM.length - 1;
    const tones = [root, root + 2, root + 4].concat(kind === '7' ? [root + 6] : []).map(d => ((d % 7) + 7) % 7);       // chord tones as scale degrees
    const kinds = kind === 'm' ? [0, 3, 7] : [0, 4, 7];              // triad shape in semitones (the 7th chord is just the major triad here: the melody carries the seventh)
    const rootMidi = scaleNote(tonic, root);
    events.push({ beat: b0, dur: 0.9, midi: rootMidi - 24 + (rootMidi - 24 < 33 ? 12 : 0), voice: 'bass', vel: 0.9 });  // oom ...
    for (const beat of [1, 2]) for (const k of kinds) events.push({ beat: b0 + beat, dur: 0.45, midi: rootMidi - 12 + k, voice: 'chord', vel: 0.5 });   // ... pah, pah
    const pat = last ? PATTERNS[4] : PATTERNS[Math.floor(rnd() * PATTERNS.length)];
    pat.forEach(([start, len], n) => {
      if (last && n === pat.length - 1) deg = 7;                    // the very end lands on the tonic
      else if (n === 0) {                                           // downbeat: nearest chord tone
        let best = deg, bd = 99; for (let d = deg - 3; d <= deg + 3; d++) if (tones.includes(((d % 7) + 7) % 7) && Math.abs(d - deg) < bd) { best = d; bd = Math.abs(d - deg); }
        deg = best;
      } else deg += [-2, -1, -1, 1, 1, 2][Math.floor(rnd() * 6)];  // otherwise a step or a skip
      deg = Math.max(5, Math.min(15, deg));                        // keep it in a singable range (about an octave and a half)
      events.push({ beat: b0 + start, dur: Math.min(len, 1) * 0.8, midi: scaleNote(tonic, deg) + 12, voice: 'mel', vel: 0.7 + (start === 0 ? 0.2 : 0) });
    });
  });
  return { beats: FORM.length * 3, events };
}

const hz = m => 440 * Math.pow(2, (m - 69) / 12);

/** The player. Nothing happens until start() is called from a click. */
export function createMusic() {
  let ctx = null, master = null, timer = null, nextBeat = 0, t0 = 0, cycle = 0, queue = [], vol = 0.4, playing = false, audio = null, tracks = [], tn = 0;
  const ext = new URLSearchParams(location.search).get('track');
  const loadTracks = async () => {
    if (ext) return [{ title: 'custom track', file: ext }];
    try { const j = await (await fetch(new URL('./audio/tracks.json', import.meta.url))).json(); return (j.tracks || []).filter(t => t && t.file); } catch (e) { return []; }
  };
  const voice = (ev, when) => {
    const f = hz(ev.midi), dur = ev.dur * 60 / BPM, g = ctx.createGain(), end = when + dur + (ev.voice === 'mel' ? 0.35 : 0.12);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = ev.voice === 'bass' ? 'sine' : 'triangle'; o2.type = 'sine'; o1.frequency.value = f; o2.frequency.value = f * (ev.voice === 'mel' ? 2 : 1.0);
    const o2g = ctx.createGain(); o2g.gain.value = ev.voice === 'mel' ? 0.25 : ev.voice === 'bass' ? 0.4 : 0;     // music-box shimmer an octave up
    g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(0.22 * ev.vel, when + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, end);
    o1.connect(g); o2.connect(o2g); o2g.connect(g);
    if (ev.voice === 'chord') { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; g.connect(lp); lp.connect(master); } else g.connect(master);
    o1.start(when); o2.start(when); o1.stop(end + 0.05); o2.stop(end + 0.05);
  };
  const pump = () => {                                              // schedule everything that starts in the next 0.4 s
    const now = ctx.currentTime, ahead = now + 0.4, spb = 60 / BPM;
    for (;;) {
      if (!queue.length) { const c = composeWaltz(1000 + cycle, KEYS[cycle % KEYS.length]); cycle++; queue = c.events.map(e => ({ ...e, beat: e.beat + nextBeat })); nextBeat += c.beats; queue.sort((a, b) => a.beat - b.beat); }
      const ev = queue[0], when = t0 + ev.beat * spb;
      if (when > ahead) break;
      queue.shift(); if (when >= now - 0.05) voice(ev, Math.max(when, now));
    }
  };
  const startSynth = () => {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    if (!master) {
      master = ctx.createGain(); master.gain.value = vol;
      const comp = ctx.createDynamicsCompressor(), dly = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();       // a little room echo
      dly.delayTime.value = 0.19; fb.gain.value = 0.28; wet.gain.value = 0.22;
      master.connect(comp); master.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(comp); comp.connect(ctx.destination);
    }
    queue = []; nextBeat = 0; cycle = 0; t0 = ctx.currentTime + 0.1;
    timer = setInterval(pump, 100); pump();
  };
  const playFile = () => {
    audio = audio || new Audio(); audio.volume = vol; audio.loop = tracks.length === 1;
    audio.onended = () => { tn = (tn + 1) % tracks.length; audio.src = new URL(tracks[tn].file, new URL('./audio/', import.meta.url)).href; audio.play().catch(() => {}); };
    audio.src = new URL(tracks[tn].file, new URL('./audio/', import.meta.url)).href; audio.play().catch(() => {});
  };
  return {
    get playing() { return playing; },
    async start() { if (playing) return; playing = true; tracks = await loadTracks(); if (tracks.length) playFile(); else startSynth(); },
    stop() { playing = false; if (timer) { clearInterval(timer); timer = null; } if (audio) audio.pause(); if (ctx) ctx.suspend(); },
    setVolume(v) { vol = v; if (master) master.gain.value = v; if (audio) audio.volume = v; },
  };
}
