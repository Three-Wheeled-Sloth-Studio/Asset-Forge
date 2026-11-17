# Model Hardpoints: First Local Preview and Review Slice

## Purpose

The **Model Hardpoints** entry in Asset Forge's project Tools menu operates on GLB models in a linked local project. It proposes a handful of geometry-derived surface points and allows a user to review or relocate them in the existing Three.js-style 3D viewport. No ComfyUI, cloud account, or model download is required.

This first slice is not semantic part recognition and does not rig or animate a mesh.

## Current workflow

1. Link Asset Forge to the project checkout that owns the GLBs. For the canonical Imperatus-Assets repo, choose the local checkout as the project folder, and set **Model folder** to `source\\ships` (or `models\\ships` for runtime derivatives). For Black Ledger Orbit, use `assets\\models\\ships`.
2. Select **Model Hardpoints** in the Tools menu, set the model folder and click **Load Models**.
3. Select a GLB. The local desktop loads it through the existing Tauri read-only model-preview command. Four initial candidates are projected onto the mesh by actual ray intersections in the model's source geometry: a rear (engine) hint, port/starboard surface hints, and a forward inspection point.
4. The proposals are **not** named or approved by AI. Their labels are only guesses based on bounding axes. Because some source ships have orientation corrections, inspect bow/stern and sides before accepting.
5. Select a candidate row, orbit/zoom the model, click the actual surface to relocate it, then optionally change the type and check **Approve**.
6. **Save Reviewed Hardpoints** writes `refs/assetForge/model-hardpoints.manifest.json` in the linked project folder. The record stores source-model-local XYZ coordinates, proposal method, individual approval flags, source path, and timestamps. A previous manifest receives a `.json.bak` backup; the ordinary project audit log receives an entry. The original GLB stays untouched.
7. Reopening the same model reads the previous review rather than replacing approved locations with new proposals.

Current types: `enginePort`, `maneuverThruster`, `navigationLight`, `weaponMountHint`, `cameraInspectAnchor`, `selectionAnchor`, `articulationCandidate`.

## Limits and next slices

- Browser-only preview cannot access local GLBs. Use the native desktop shell.
- Raycast candidate positions depend on GLB orientation; this slice doesn't infer real propulsion, symmetry, turret geometry, joint axes, or physical articulation. A single-mesh source can still be examined and assigned exterior surface points.
- Coordinates are **source GLB-local, +Y up**. Downstream consumers must apply the approved orientation transform separately. Do not paste these coordinates directly into normalized Godot bounds fractions without conversion.
- Exposing an existing approved manifest to TWS-Video, normalizing its coordinates for Godot, supporting per-ship profiles, and introducing 3D visual tests are separate integration tasks.
- Next geometry analysis: component connectivity, material/UV segmentation, symmetry pairs, candidate normal/orientation, real triangle attachment, surface clearance and part-size heuristics. Add a confidence/evidence column.
- Optional local semantic model should be a *second opinion* on rendered multi-view images and analyzed geometry, never the primary source of numeric surface positions. Benchmark model accuracy, licensing and 12GB GPU footprint before integrating one.
- For actual moving mechanical parts, need mesh/component segmentation plus joint or pivot estimates, a reversible preview, and explicit acceptance. Do not cut original assets or generate fake animation.
- Model and texture ingestion remains owned by Imperatus-Assets with stable IDs, provenance, manifest validation, and LFS. Asset Forge should produce reviewable **proposals**, not silently mutate canonical source.

## Validation

From the Asset-Forge checkout on Windows, use its normal installer/development launcher and check that the tool opens in the desktop shell. Load a known GLB, select and relocate a point, approve it, save, reopen, and verify the coordinate and approval persist.

Rust/Tauri and WebGL runtime, along with the heavy 1.5M-triangle ship performance, have **not** been tested by the GitHub-only implementation environment. Model-rendering performance may be CPU-bound. Evaluate the optimized LOD first if the full original is slow.
