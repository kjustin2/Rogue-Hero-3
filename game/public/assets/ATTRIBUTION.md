# Rogue Hero III asset attribution

The Graphic Dark-Fantasy vertical slice currently ships its original code-generated
Three.js actors, environment kit, interface art, and effects. No third-party GLB,
texture, image, or audio asset was added by this overhaul.

The optional hybrid asset registry probes these original-asset slots and silently
uses the procedural production fallback when a file is absent:

- `actors/blade.glb`
- `actors/husk.glb`
- `actors/spitter.glb`
- `actors/sentinel.glb`
- `actors/pit-warden.glb`
- `environments/rift-basilica.glb`

Any future file added to one of those slots must be original work or permissively
licensed, and its creator, source URL, license name, and modification notes must be
recorded in this file before release.
