# Optional 3D models

Put a `.glb` here, name it in `models.json` (`{ "cottage": "cottage.glb" }`) and the social-group cottages use it instead of the built-in house (see `../models.js`). To try a file without committing it: add `?model=URL` to the Atlas address.

* Any glTF binary (`.glb`) works. Textures are ignored; material colors are kept. The model is centered, set on the ground and scaled to fit.
* Ready-made models: Poly Pizza (https://poly.pizza), Quaternius and Kenney publish many under CC0. Check each model's license on its page.
* If the file is missing or unreadable the built-in house is used, so it is safe to leave this folder empty.

## Slots in `models.json`

| Key | Used for | Current file |
|---|---|---|
| `cottage` | social-group cottages | (empty: built-in house) |
| `princess` | the Kira Peikoff Easter egg (replaces the built-in princess; same spot, name label, click and card) | `princess-peach.glb` |
| `midas` | Midas Peikoff, a dog flying a red plane in circles over the gulch (Easter egg; the plane's original color is swapped for Peikoff red `#d0242b`) | `dog-in-plane.glb` |
| `guitar` | Ason Peikoff's guitar, held in a playing pose (he stands outside Postsocialist Press) | `props/guitar.glb` |
| `scooter` | one pedestrian (a walker without a Peikoff highlight) rides it on the streets, 2.4x walking speed | `props/scooter.glb` |
| `car` | the car lot: four Range Rovers on open ground near the city (the lot finds ground clear of water, mountains, cottages, buildings and track) | `props/range-rover.glb` |
| `motorcycle` | six motorcycles in the car lot | `props/motorcycle.glb` |
| `train` | the Atlantis Railway: the folder `train/` holds the Modular Train Pack `.glb` files (straight and curved track, locomotive, high-speed and cargo cars). Pieces are used at 3x. A closed track loop is placed where it touches nothing of ours (no water, cottages, buildings or streets) and runs through tunnels where it meets a mountain; three trains run on it at 14-34 m/s (the locomotive gives off steam); click a train for its card. | `train/` |

Authors, from the file names: "Princess Peach" by Chris Ross, "Dog in plane" by Nikki Morin (both from Poly Pizza). The licenses were not checked here: confirm each on its Poly Pizza page before relying on them, and add the credit the license requires. Setting a slot to `""` restores the built-in shape.


`props/hourglass.glb` is stored for the planned Time Machine and is not placed anywhere yet. Unlike the cottage and figure loaders, `loadScene` keeps a model's own textures (the Range Rover and the motorcycle need them).

## Places (`/home`, `/salon`, `/speak`, `/work`)

| Slot | File | Used as |
|---|---|---|
| `villa` | `places/villa.glb` | Ayn Rand's lakeside villa (the `/salon` gathers on its lawn) |
| `castle` | `places/castle.glb` | Home of Ason, Onkar, Yaron (and Midas); Carl gets a second one on the far side of the city |
| `suite` | `places/suite.glb` | Mother-in-law suite beside the castle: Amy, Barbara, Leonard |
| `apartment` | `places/apartment.glb` | Everyone else's home |

Commands (type in the search box): `/speak` forum, `/salon` villa, `/home` homes, `/work` back to work.
