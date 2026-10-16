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
| `oilpump` | `props/oil-pump.glb` | Three oil pumps (13 m) on open ground beside the freight line between the depot and the mountain, at least 40 m from the track ("Oil pump" by Poly by Google, Poly Pizza; confirm the license) |
| `rover` | `props/rover.glb` | Two rovers (11 m) beside the Atlantis Mine ("Rover" by Quaternius; CC0 on Poly Pizza, confirm) |
| `train` | the Atlantis Railway: the folder `train/` holds the Modular Train Pack `.glb` files (straight and curved track, locomotive, high-speed and cargo cars). Pieces are used at 3x. A freight line (not a loop) is placed where it touches nothing of ours (no water, cottages, buildings or streets): from a depot beside the city through a mountain by tunnel to the mine; one freight train shuttles on it at 14 m/s (a locomotive at each end) and hauls the ore of the mine to the depot (the locomotive and high-speed `.glb` files are kept but not loaded: with several trains on one track they drove through each other); click the train for its card. | `train/` |

Authors, from the file names: "Princess Peach" by Chris Ross, "Dog in plane" by Nikki Morin (both from Poly Pizza). The licenses were not checked here: confirm each on its Poly Pizza page before relying on them, and add the credit the license requires. Setting a slot to `""` restores the built-in shape.

| `rollsroyce` | `places/rolls-royce.glb` | Ayn Rand's Rolls-Royce, 14 m long (the cars in the lot are 15 m), parked against the villa between its wall and Rand's Estate, parallel to the house ("Rolls Royce" by David Sirera, Poly Pizza; confirm the license) |

`props/hourglass.glb` is stored for the planned Time Machine and is not placed anywhere yet. Unlike the cottage and figure loaders, `loadScene` keeps a model's own textures (the Range Rover and the motorcycle need them).

## Places (`/home`, `/salon`, `/speak`, `/work`)

| Slot | File | Used as |
|---|---|---|
| `villa` | `places/villa.glb` | Ayn Rand's lakeside villa (the `/salon` gathers on its lawn) |
| `castle` | `places/castle.glb` | Home of Ason, Onkar, Yaron (and Midas); Carl gets a second one on the far side of the city |
| `suite` | `places/suite.glb` | Mother-in-law suite beside the castle: Amy, Barbara, Leonard |
| `apartment` | `places/apartment.glb` | Everyone else's home |
| `estate` | `places/rands-estate.glb` | Rand's Estate, the building beside Ayn Rand's villa (label and minimap name \"Rand's Estate\"): 46 m long, beside the villa on dry ground, facing the city; cottages keep clear of it (model by Nick Kramer, Poly Pizza; confirm the license) |

Commands (type in the search box): `/speak` forum, `/salon` villa, `/home` homes, `/work` back to work.
