# Rogue Hero III

From this directory, run `npm install` once, then `npm start` to build and play.

`npm test` runs one quick, isolated Electron smoke. The `qa`, `qa:fast`,
`qa:loop`, and `smoke` commands are aliases; choose one. No rebuild, unit
suite, visual analysis, AI review, or performance test runs automatically.
The smoke has a 30-second deadline. Detailed testing belongs to manual play.

`npm run dev` starts Vite. `npm run build` checks TypeScript and builds the app.
`node scripts/smoke.mjs --screenshots` adds two optional captures.
`node scripts/smoke.mjs --production` smokes the existing production build.

See [the root README](../README.md) for controls, packaging, and manual shortcuts.