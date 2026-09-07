# Blade motion authoring

`attack-curves.blend` is an editable **animation control bank**, not a finished
Blender character or a GLB model. The shipped articulated mesh remains in
`src/render/heroForge.ts`. No external assets or Blender runtime are required.

Four collections contain opener, return, finisher and charged-heavy curves.
Frame 1 is attack phase 0; frame 101 is phase 1. Each numbered Empty's X Euler
curve stores one game-local scalar: shoulder XYZ (00–02), torso XYZ (03–05),
offhand XYZ (06–08), elbow X (09), right/left knee X (10–11), body pitch (12),
body vertical offset (13). These are game coordinates, not Blender world axes.

Edit curves in Blender's Graph Editor and save the file. Export the saved edits:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python game/art/blade/author_motion.py -- --export-existing
```

Run from repository root. Without `--export-existing`, the script rebuilds the
control bank from the authored keys in Python, replacing the `.blend`.
The exporter evaluates Blender curves at 101 phase samples per clip and writes
`src/game/bladeMotionData.ts`. Combat and rendering share its contact phases:
0.28 / 0.32 / 0.42 / 0.38. Combat owns durations; animation owns pose. The charged
strike has its own overhead anticipation and grounded follow-through.

No independent animation timer, root motion, collision changes, or hitstop.
Inspect the motion on the actual Blade at gameplay scale after authoring; the
control bank alone cannot prove blade contact, silhouette or animation quality.
