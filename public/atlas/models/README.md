# Optional 3D models

Put a `.glb` here, name it in `models.json` (`{ "cottage": "cottage.glb" }`) and the social-group cottages use it instead of the built-in house (see `../models.js`). To try a file without committing it: add `?model=URL` to the Atlas address.

* Any glTF binary (`.glb`) works. Textures are ignored; material colors are kept. The model is centered, set on the ground and scaled to fit.
* Ready-made models: Poly Pizza (https://poly.pizza), Quaternius and Kenney publish many under CC0. Check each model's license on its page.
* If the file is missing or unreadable the built-in house is used, so it is safe to leave this folder empty.
