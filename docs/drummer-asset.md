# Drummer asset

Generated with the built-in imagegen tool on 2026-10-01.
Current project asset: `public/drummer-rig.png` (1254 × 1254 RGBA PNG, four equally sized rig-part cells).
It is an imagegen edit of the original `public/drummer-atlas.png`, which is retained as the source reference.
The cells contain the body with its holding arm and drum, the upper striking arm, the forearm and gripping hand, and the beater.
The renderer articulates the striking arm with fixed-length inverse kinematics and composites the textured planes in ray order. The body uses restrained procedural breathing, inclination and recoil. This is a layered character rig, not a full 3D human mesh.
The transparent sprite is a respectful cinematic interpretation, not an ethnographic reconstruction.
Cosmic geometry, lighting, continuous pose animation, optical fall, elastic membrane and outgoing waves are rendered in code.

## Final rig edit prompt

```text
Use case: precise-object-edit.
Edit target: the referenced four-frame Buryat musician image. Preserve this man's identity, clothing, face, realistic style, drum and lighting. Convert it into a FOUR-PART RIG ATLAS, for continuous skeletal animation, NOT four complete poses.
Output square 2x2 atlas, truly transparent background, no text, borders or scenery. Each part isolated entirely in its own equal quadrant, with clear transparent margins.
TOP LEFT: one complete full body of this musician, facing front, weight on his legs, warm attentive face looking toward camera. His left arm (viewer right) holds the round leather frame drum in exactly the same chest position as reference. REMOVE ONLY his right arm (viewer left) below the shoulder: the body torso should have a clean closed indigo shoulder joint with no arm sticking out. No beater on the body. This is a layered puppet base, not an injured person. Body and drum centered, full feet visible.
TOP RIGHT: isolated matching RIGHT UPPER ARM only, sleeve from shoulder joint to elbow, straight vertically downward, shoulder at top and elbow at bottom, indigo cloth and matching bronze trim, cylindrical round ends with a little overlap for joints, no torso or hand.
BOTTOM LEFT: isolated matching RIGHT FOREARM with naturally clenched hand gripping an invisible thin shaft, straight vertically downward, elbow/cuff at top, wrist then hand at bottom. Same skin and indigo sleeve, realistic anatomy, rounded overlaps. No beater attached.
BOTTOM RIGHT: one isolated long wooden drum beater only, straight vertically, padded oval striking head at TOP, thin wooden shaft going DOWN to the grip at bottom. Matches reference.
Lighting consistent warm light from viewer right, blue rim from left. Crisp detailed photoreal game-character layers. Do not put a complete musician in any quadrant except top left. Four clean separable parts are essential. Transparent alpha in every unused area.
```

## Original generation prompt

```text
Use case: stylized-concept
Asset type: production animation sprite atlas for a cinematic WebGL space experience.
Primary request: a dignified adult Buryat male musician, around 40, beating a large round leather frame drum with one padded wooden beater. Four animation frames of exactly the same musician on a truly transparent background.
Composition: square 2 by 2 sprite atlas, four equal quadrants. In EACH quadrant the identical full body subject is centered, the feet and head at the same coordinates, with generous transparent margins, front view, subtle three-quarter angle. Nothing may cross the quadrant boundaries. Top left = beater lifted, top right = beater descending, bottom left = drum contact, bottom right = recovering. Left hand holds drum; right hand beats. Same face, clothes, drum position and size in all four frames; ONLY the right forearm and beater change pose.
Subject: authentic-looking East Asian Buryat adult man, warm composed expression, short dark hair, midnight indigo long robe with restrained bronze trim and woven details, leather boots. Respectful contemporary cinematic interpretation, no claim of ceremonial authenticity.
Style: exceptionally detailed photoreal cinematic character render, crisp silhouette, fine skin, fabric and hide texture, realistic anatomy.
Lighting: warm amber light from the drum in front, subtle cool blue rim light behind. Deep beautiful dark colors, readable face and hands.
Drum: circular pale warm leather membrane, dark wood rim, realistic grip, no symbols or writing.
Constraints: isolated character only, genuinely transparent alpha in all unused pixels, no scenery, no smoke or ground shadow, no text, no borders, no labels, no watermark, no feather headdress, no caricature. Exact 2x2 aligned atlas with consistent camera, scale and framing. High resolution square.
```
