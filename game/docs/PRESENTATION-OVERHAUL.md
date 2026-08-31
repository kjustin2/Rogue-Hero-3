# Graphic Dark-Fantasy Presentation Direction

The vertical slice is **The Blade + Husk + Spitter + Sentinel + Pit Warden** in
the rebuilt Act I Rift Basilica. Simulation, hitboxes, saves, and seeded timing
remain authoritative; animation and effects only interpret resolved state.

## Visual grammar

- 70% matte charcoal/ink, 20% warm stone and ember, 10% emissive magic.
- Cyan identifies the hero; coral identifies hostile attacks; gold identifies
  parry/critical beats; green identifies healing; violet identifies Rift goals.
- Calm frames show place and silhouette. Attack frames spend brightness at the
  contact point. Aftermath leaves small scars instead of more screen-wide rings.
- Telegraphs are flat and quiet. Impacts are brief, directional, white-cored,
  and target-local. UI never competes with the active threat.

## Reference lessons, translated rather than copied

- Strong isometric action games keep dark environments materially varied, so
  darkness frames actors instead of erasing them.
- The player remains the most stable high-contrast shape while attack color is
  concentrated at the current verb and target.
- Authored foreground, midground, and vista layers make a combat room feel like
  a place even when its collision footprint stays simple.
- Menu screens stage one hero and one decision clearly; dense comparison data is
  secondary to identity and action.

## Performance budgets

- Calm: <=250 draw calls. Normal combat: <=450. Existing stress: <=800.
- High at 1080p: p95 <=18.5ms after warm-up; no post-warm frame >50ms.
- Repeated static props use instancing; transient presentation objects are pooled.
- Optional GLBs use documented licenses and always retain a procedural fallback.
