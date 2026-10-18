// One elevator per tall building, as a small state machine. Pure logic (no browser objects), so it is unit-tested in node.
// A rider calls request(id, fromZ, toZ), waits in the queue on their floor (queueSpot gives each place in line), and walks into the car only once it has
// arrived there and opened (phase 'boarding' -> boarded(id)). The car then carries up to CAPACITY riders and opens at each destination (phase 'exiting' -> release(id)).
export const CAPACITY = 4;           // riders per car
export const CAB_SPEED = 9;          // car speed, data units per second
export const DOOR_OPEN = 1.2;        // seconds the doors stay open at a stop, at least
export const DOOR_WAIT = 4;          // longest the car waits for someone to step in or out before it moves on
export const PARK_AFTER = 4;         // an empty car goes back to the ground floor after this many seconds idle
const EPS = 0.05;

export class Elevator {
  constructor(speed = CAB_SPEED) { this.speed = speed; this.z = 0; this.state = 'idle'; this.t = 0; this.target = 0; this.reqs = new Map(); this.seq = 0; }
  has(id) { return this.reqs.has(id); }
  phase(id) { return this.reqs.get(id)?.phase ?? null; }                            // 'waiting' | 'boarding' | 'riding' | 'exiting' | null
  request(id, from, to) { if (!this.reqs.has(id)) this.reqs.set(id, { from, to, phase: 'waiting', n: this.seq++ }); }
  boarded(id) { const r = this.reqs.get(id); if (r && r.phase === 'boarding') r.phase = 'riding'; }
  release(id) { this.reqs.delete(id); }                                                // stepped out of the car (or gave up)
  waitingAt(z) { return [...this.reqs].filter(([, r]) => r.phase === 'waiting' && Math.abs(r.from - z) < EPS).sort((a, b) => a[1].n - b[1].n).map(([id]) => id); }
  queueIndex(id) { const r = this.reqs.get(id); return r ? this.waitingAt(r.from).indexOf(id) : -1; }   // place in line on their floor (0 = next)
  inCar() { return [...this.reqs].filter(([, r]) => r.phase === 'riding' || r.phase === 'boarding').length; }
  busy() { return this.reqs.size > 0 || this.state !== 'idle' || this.z > EPS; }
  _next() {                                                                          // where to go: a rider's stop first (nearest), else the longest-waiting caller
    const riding = [...this.reqs.values()].filter(r => r.phase === 'riding');
    if (riding.length) return riding.reduce((b, r) => Math.abs(r.to - this.z) < Math.abs(b - this.z) ? r.to : b, riding[0].to);
    const w = [...this.reqs.values()].filter(r => r.phase === 'waiting').sort((a, b) => a.n - b.n)[0];
    return w ? w.from : null;
  }
  _open() {                                                                          // doors open at this.z: riders for this floor get out, callers here may step in (a few at a time)
    this.state = 'open'; this.t = 0;
    for (const r of this.reqs.values()) if (r.phase === 'riding' && Math.abs(r.to - this.z) < EPS) r.phase = 'exiting';
    this._board();
  }
  _board() {
    let room = CAPACITY - this.inCar();
    for (const id of this.waitingAt(this.z)) { if (room-- <= 0) break; this.reqs.get(id).phase = 'boarding'; }
  }
  step(dt) {
    if (this.state === 'moving') {
      const dz = this.target - this.z, mv = this.speed * dt;
      if (Math.abs(dz) <= mv) { this.z = this.target; this._open(); } else this.z += Math.sign(dz) * mv;
    } else if (this.state === 'open') {
      this.t += dt;
      for (const r of this.reqs.values()) if (r.phase === 'boarding' && this.t >= DOOR_WAIT) r.phase = 'riding';        // someone stuck: leave without waiting longer
      for (const [id, r] of this.reqs) if (r.phase === 'exiting' && this.t >= DOOR_WAIT) this.reqs.delete(id);
      if (this.t >= DOOR_OPEN && ![...this.reqs.values()].some(r => r.phase === 'boarding' || r.phase === 'exiting')) {
        this._board();                                                               // someone arrived late and there is room: keep the doors open for them
        if (![...this.reqs.values()].some(r => r.phase === 'boarding')) { this.state = 'idle'; this.t = 0; }
        else this.t = 0;
      }
    }
    if (this.state === 'idle') {
      const n = this._next();
      if (n === null) { this.t += dt; if (this.t >= PARK_AFTER && this.z > EPS) { this.target = 0; this.state = 'moving'; } return; }
      this.t = 0;
      if (Math.abs(n - this.z) < EPS) this._open(); else { this.target = n; this.state = 'moving'; }
    }
  }
}

/** Where the person at place `idx` in line stands: rows of three just in front of the car (towards the door wall, or behind it when the lobby is too shallow). A line too long for the
 *  lobby carries on outside, in single file along the street in front of the building (alternately right and left of the door), instead of out through the walls into the next building. */
export function queueSpot(arch, b, idx, sep) {
  const a = arch, dir = a.ey - b.y0 >= sep * 2.2 ? -1 : 1, room = dir < 0 ? a.ey - b.y0 : b.y1 - a.ey, rows = Math.max(1, Math.floor((room - 1) / sep)), inside = 3 * rows;
  if (idx < inside || !Number.isFinite(b.y1)) return [a.ex + ((idx % 3) - 1) * sep, a.ey + dir * sep * (1 + Math.floor(idx / 3))];
  const k = idx - inside, side = k % 2 ? 1 : -1;                                          // outside: the door stays free, the line grows away from it
  return [(b.x0 + b.x1) / 2 + side * (2 * sep + Math.floor(k / 2) * sep), b.y0 - 2];
}

/** Which car a person takes: of the cars they may use (the executive car only if `exec`, and then only that), the nearest to (x, y), with a penalty for each person already waiting at floor z or riding. */
export function chooseCar(cars, elevators, z, x, y, exec) {
  let best = 0, bs = Infinity;
  cars.forEach((c, ci) => { if (!!c.exec !== !!exec) return; const e = elevators[ci]; if (!e) return; const s = Math.hypot(c.ex - x, c.ey - y) + 4 * (e.waitingAt(z).length + e.inCar()); if (s < bs) { bs = s; best = ci; } });
  return best;
}
