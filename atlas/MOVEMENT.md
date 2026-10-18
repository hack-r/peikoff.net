# How movement works in the Atlas (and where the shapes come from)

Everything that moves here is one idea repeated: **once per frame, work out where a thing should be, and put it there.**
The browser calls our function about 60 times a second; the screen then shows whatever positions we left behind.

## 1. The loop (`public/atlas/main.js`, last lines)

```js
renderer.setAnimationLoop(t => {
  const dt = Math.min((t - last) / 1000, 0.1);   // seconds since the last frame (capped so a stalled tab doesn't teleport things)
  stepFly(dt);                                   // camera glides
  stepWalkers(dt);                               // people walk
  scenery.userData.stepFish(dt, t / 1000);       // fish swim
  scenery.userData.stepPrincess?.(t / 1000);     // princess writes
  last = t;
  renderer.render(scene, camera);                // draw the frame
});
```

`dt` ("delta time") is the whole trick. Never move "5 units per frame" (fast screens would run faster); move **speed x dt**
("1.5 units per second x 0.016 s"). Then motion is the same speed on any machine.

## 2. Four kinds of motion, easiest first

| Kind | Used for | The rule | Where |
|---|---|---|---|
| **Wave of time** | princess writing, glancing around and breathing; fish wobble | `value = base + Math.sin(time * speed) * size` | `stepPrincess`, the sin terms in `stepFish` |
| **Move toward a goal** | camera flying to a person | `position = lerp(from, to, k)` where `k` goes 0 -> 1 | `stepFly` |
| **Walk a list of points** | people on the street grid | keep a distance travelled `d`; find which segment `d` falls in; blend between its two ends | `planPath`, `stepWalkers` |
| **Ride a curve** | fish in the stream | keep `t` in 0..1; ask the curve for its point and direction at `t` | `stepFish` (uses three.js `CatmullRomCurve3`) |

### Wave of time (the "hello world" of motion)

```js
armR.rotation.x = -1.15 + Math.sin(time * 7) * 0.07;
//                 ^ resting angle       ^ how fast  ^ how far either side   (the pen scribbling on the page)
```

`Math.sin` just swings smoothly between -1 and 1. Multiply to set how far, add to set the middle, scale `time` to set how fast.
Change one number at a time and reload; that is the fastest way to build intuition.

### Walk a list of points (why it looked incomprehensible)

A walker has a path `pts = [A, B, C, ...]` and a single number `d` = distance walked so far. Each frame:

```js
P.d += speed * dt;                       // 1. advance the distance
let n = 0, rem = P.d;                    // 2. which leg are we on? subtract finished legs' lengths
while (rem > P.segs[n]) { rem -= P.segs[n]; n++; }
const f = rem / P.segs[n];               // 3. how far along that leg, 0..1
x = a.x + (b.x - a.x) * f;               // 4. blend the leg's two ends  ("lerp")
heading = Math.atan2(dx, dy);            // 5. face the direction of travel
```

That is all of it. `planPath` only decides the points (out the door, along the sidewalk, around street corners, into the next
door); `stepWalkers` is the five lines above plus bookkeeping (pause at each building, then plan the next leg).

### Ride a curve (fish)

```js
f.t = (f.t + speed * dt / curve.getLength()) % 1;   // progress as a fraction of the stream's length
curve.getPointAt(f.t, P);                           // where is that on the stream?
curve.getTangentAt(f.t, T);                         // which way does it point there?
fish.position.set(P.x - T.z * side, 0.5, P.z + T.x * side);   // nudge sideways: (-T.z, T.x) is the tangent turned 90 degrees
fish.rotation.y = Math.atan2(-T.z, T.x);            // point the nose along the stream
```

Bug we hit: on the first frame `dt` can be negative or NaN, `t` went outside 0..1 and the whole scene went blank.
Moral: clamp inputs (`Math.max(0, dt)`), keep progress inside its range, and when the screen goes blank look at the console first.

## 3. Debugging movement

* **Slow motion:** multiply `dt` by 0.1 and watch.
* **Freeze a frame:** call the step function once by hand with a fixed `dt` instead of from the loop (that is how the tour video is rendered: step, screenshot, step, screenshot).
* **Draw the path:** add small spheres at each path point so you can see what the walker is following.
* **Log one thing:** `console.log(p.d, n, f)` for a single walker beats staring at 600.

## 3b. Idle motion: how people who are not walking still move

A person is no longer one rigid block. They are split at the joints into 8 instanced meshes (torso, two legs, two upper arms, two forearms, head).
Each limb is modelled hanging straight down from its pivot, and `placeOne(i)` chains matrices: base matrix, then hip/shoulder/elbow/neck rotation.
The rotations come from a **pose**: 19 numbers per person (lean, head, shoulders, elbows, hips, yaw).

* **States** (`nextState`): idle, look around, stretch, yawn, hand on hip, cross legs (sometimes with folded arms). Each state is just a function that writes a *target* pose (`aim`) from sine waves of time.
* **Easing:** the current pose moves a fraction of the way to the target each frame (`p[j] += (T[j] - p[j]) * kk`), so changes between states are smooth.
* **Conversations** (`stepPairs`): neighbours on the same floor within 4.5 units are paired once at start-up. Now and then a pair turns to face each other; the speaker gestures, the listener nods, and if they stand within arm's reach one puts a hand on the other's shoulder.
* **Walkers** swing arms and legs: the phase of the sine wave is the distance walked divided by the stride length.
* **Regalia people** (Ayn Rand's dress, a professor's jacket) have costume parts that are rigid, so they only turn; their limbs do not move.
* Switch it all off with the "Idle motion" checkbox. In safe mode (no instancing) the old rigid body is kept.

## 3c. Doors and elevators: how walkers get in and out of buildings

People no longer fly diagonally through walls. `public/atlas/paths.js` (pure geometry, unit-tested in node) plans every trip as a list of legs:

1. walk across the floor to the building's elevator (a shaft just inside the south door),
2. wait for the cabin, then **ride down** (a ride only changes height, never position),
3. walk out of the **door** (the only gap in the south wall) onto the sidewalk,
4. walk the street lattice (rows and columns of the grid, offset to the sidewalk lane) to the target building's street,
5. in through *its* door, to *its* elevator, **ride up** to the floor, and walk to a spot on that floor.

`stepWalkers` follows the legs one after another, turns the person to face where they are heading, and moves the elevator cabin with the rider (an empty cabin sinks back to the ground floor).
Doors are lit amber boxes, shafts are faint blue columns, and cabins are blue boxes. `test/paths.test.js` checks that every trip is one connected path, that floors change only in an elevator, and that no street-level leg crosses another building.
Atlas Network (15 floors) has three elevators (`CAR_OVERRIDES` in `paths.js`), like the tallest building; the multi-rider rules (standing spots per car) are designed separately and apply per car, so this change only adds shafts.

## 4. Where the shapes come from

Nothing is downloaded. There are no model files and no third-party assets. Every shape is one of three.js's built-in
geometry classes (`BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry`, `PlaneGeometry`),
moved with `.translate()` / `.rotateX()` / `.scale()` and glued into one mesh with `mergeGeometries`.
A person is two cylinders (legs), a box (torso), four short cylinders (two arms, each in two segments), a cylinder (neck) and a sphere (head).
The mountains are cones, the princess's gown is a cone with the top cut off, her book is three flat boxes, her crown is a ring plus five tiny cones.
The skeleton fish is a spine (a long thin cylinder), a skull (a squashed sphere), seven pairs of ribs (thin cylinders, tilted) and a fan of tail bones, all merged into one mesh. The pirate ship is boxes for the hull and sails, thin cylinders for masts, a cone for the bow, and a tiny sphere plus two cylinders for the skull and crossbones on the flag.
The three.js library itself is vendored in `public/atlas/vendor/` (no build step); its documentation is at threejs.org.
For fancier shapes you would load a model file (glTF is the usual format) instead; we have not needed to.
