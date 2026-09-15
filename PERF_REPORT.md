# PHASE 1 — experimental foundation, acceptance pending

**Status: incomplete; no performance pass claimed.** The release default still uses the existing rendering path. The new path is opt-in with `?photoreal=1`. PHASE 2/3 have not started because the prompt requires measured PHASE 1 acceptance first. No deployment or phase-completion commit was made.

## Run and compare

```sh
python3 scripts/generate_render_assets.py
node --test tests/render-settings.test.mjs
python3 build_standalone.py
python3 serve.py 8787
```

- Baseline: `http://localhost:8787/index.html?profile=1`
- Experimental: `http://localhost:8787/index.html?photoreal=1`
- Development: replace `index.html` with `dev.html`.
- Keep the `assets/` directory beside either HTML file and use HTTP(S). The rendering mode fetches external binary assets; opening it with `file://` is unsupported.
- Use the same viewport, map, character matchup and sequence on both runs. Let initial shaders settle. Open **그래픽 · 측정**, start recording, play, stop, and save JSON. Captures are capped at 3,600 samples and include raw rAF intervals, all rendering-pass draw calls, triangle submissions, preset and actual drawing-buffer scale. This is not a GPU timer or Chrome DevTools trace.
- Capture matched before/after screenshots and a separate Chrome DevTools Performance trace. Test each preset, resizing, repeated map switches, hits, intro/finishers and WebGL. Repeat on RTX3060, an integrated GPU and physical iPhone 13 Safari. iOS viewport emulation is not a substitute.

## Evidence available in this environment

| Check | Observed result |
|---|---|
| Resolution governor tests | 3 tests passed: sustained overload/recovery, isolated stalls/hidden tabs, device default selection |
| JavaScript syntax | Every `js/*.js` module and generated inline module parsed with Node 22 |
| Build | Succeeded; both generated HTML files are identical |
| HDR decoding | Parsed by actual Three.js r170 RGBELoader: 512×256, finite values, maximum linear radiance 13.992156982421875 |
| Opacity data | Exactly 16,384 bytes; transparent border, opaque center verified |
| Postprocessing API | AgX, DOF focus uniform and four SMAA presets checked against pinned library source/runtime |
| Ring lifecycle | 10 create/update/dispose cycles passed with actual Three.js geometry/materials and stubbed canvas: exactly 3 lights, 1 shadow caster, no scene children left after disposal. This is not GPU rendering. |
| Existing HTML size at HEAD | 462,403 bytes on disk |
| New external rendering assets | 540,721 bytes total on disk; not measured network transfer |
| Browser connection | Browser runtime initialized, but discovery returned no connected browsers |
| FPS / frame-time variation / draw calls | **Not measured** |
| Before/after screenshots / Chrome trace | **Not captured** |
| 3G/desktop/mobile loading and FPS targets | **Not verified** |

HTML and asset byte counts exclude CDN libraries, fonts, audio and transport headers. They are not the initial transfer size and cannot establish the 12MB or loading-time criteria. No unavailable result has been estimated.

## Implemented in the experimental path

- Original sub-1MB RGBE environment, PMREM prefilter and environment intensity; original contact-shadow opacity data follows active ring fighters and fades with jump height.
- AgX and sRGB output; existing boxer meshes and ring surfaces use PBR materials. Geometry and animation assets remain the existing low-poly assets.
- Ring lighting: one shadow-casting spotlight plus two unshadowed fills; ceiling fixtures are instanced emissive geometry selected explicitly for bloom. Map disposal releases ring lights, textures, materials and shadow resources.
- pmndrs composer: Render → half-resolution N8AO → hit-driven radial blur → selective bloom → cinematic-only DOF → AgX → SMAA → restrained vignette/noise/chromatic aberration. HDR effects precede a single tone-map stage; N8AO gamma correction is disabled.
- Low/medium/high/ultra controls, conservative initial device heuristic and saved manual effect-quality choice. Q cycles presets. Dynamic resolution remains independent of manual effect quality.
- Frame-time governor: 1.0 → 0.85 → 0.7 → 0.6 with overload windows, cooldowns and sustained recovery trials. Suspended frames cannot trigger a downshift. This is an algorithm test, not device performance evidence.
- External asset checksum validation in the standalone build; original asset generator and provenance inventory.

## Remaining acceptance work and deliberate deviations

1. **WebGPU is not implemented.** The current character outline, trail and spark shaders use GLSL ShaderMaterial, and characters use onBeforeCompile. [Three.js documents these as unsupported in WebGPURenderer](https://threejs.org/manual/en/webgpurenderer). [pmndrs EffectComposer is a WebGL renderer pipeline](https://pmndrs.github.io/postprocessing/public/docs/class/src/core/EffectComposer.js~EffectComposer.html). A real WebGPU route requires node-material equivalents and a separate postprocessing backend. No fake capability flag or successful fallback test is claimed.
2. **CSM is not implemented.** Ring shadows are single-map spotlight shadows, at 1024/2048 depending on preset. Cascaded directional shadows and a single overhead shadow-casting spotlight are different lighting arrangements; adding three shadow lights without measurement would violate the light/performance constraints. The contact opacity decal is an approximation, not real-time contact-shadow tracing.
3. **SSGI, SSR, velocity motion blur, TRAA and LUT grading remain pending.** N8AO and SMAA run in the new path; hit blur is explicitly radial blur, not realism-effects motion blur. No wet-floor reflection claim is made.
4. **Physical device testing and tuning remain pending**, including a mobile 30fps fallback lock, <3ms frame-time variation, and ≤150 draws. Quality upgrades must not become the release default before these checks pass.
5. **PHASE 2 assets remain pending:** realistic rigged human GLBs/LODs, complete PBR texture sets, KTX2/Meshopt compression, retargeted motion, audience impostors and baked arena lighting. The current material conversion is not a photoreal character replacement. Missing assets will be authored rather than substituted with assets of unknown rights.

The scene has not been visually verified, so exposure, AO radius, skin clearcoat and DOF values are starting settings, not accepted art direction. The experimental flag keeps unmeasured work reviewable without promoting it to the release path.
