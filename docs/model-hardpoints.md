# Model Hardpoints: First Local Preview and Review Slice

## Purpose

The **Model Hardpoints** entry in Asset Forge's project Tools menu operates on GLB models in a linked local project. It proposes a handful of geometry-derived surface points and allows a user to review or relocate them in the existing Three.js-style 3D viewport. No ComfyUI, cloud account, or model download is required.

This first slice is not semantic part recognition and does not rig or animate a mesh.

## Current workflow

1. Link Asset Forge to the project checkout that owns the GLBs. For the canonical Imperatus-Assets repo, choose the local checkout as the project folder, and set **Model folder** to `source\\ships` (or `models\\ships` for runtime derivatives). For Black Ledger Orbit, use `assets\\models\\ships`.
2. Select **Model Hardpoints** in the Tools menu, set the model folder and click **Load Models**.
3. Select a GLB. The desktop loads it through the Tauri read-only preview command and applies the model's **saved yaw/pitch/roll/scale from Model Orientation** before proposing candidate points. Four candidates are projected onto the oriented mesh using ray intersections: aft (engine hint), port, starboard, and bow inspection. The geometry remains unchanged.
4. A source GLB may be backwards. In **Model Orientation**, save a correct forward orientation first, then return here and click **Load Models / Refresh Orientation**. Candidate naming uses the canonical **-Z forward, +Y up, -X port, +X starboard** frame *after applying that orientation*. Use **View stern**, **View bow**, **View port**, **View starboard**, and **View top** to inspect. The proposals are still geometry hints, not AI-recognized parts.
5. Select a candidate row, orbit/zoom the model, click the actual surface to relocate it, then optionally change the type and check **Approve**.
6. **Save Reviewed Hardpoints** writes `refs/assetForge/model-hardpoints.manifest.json` in the linked project folder. The record stores source-model-local XYZ coordinates, proposal method, individual approval flags, source path, and timestamps. A previous manifest receives a `.json.bak` backup; the ordinary project audit log receives an entry. The original GLB stays untouched.
7. Reopening the same model reads the previous review rather than replacing approved locations with new proposals. If an earlier proposal was generated before correcting orientation, explicitly select **Refresh Unapproved Suggestions**. Approved points are intentionally preserved for manual verification, since changing orientation should never silently move approved locations.

Current types: `enginePort`, `maneuverThruster`, `navigationLight`, `weaponMountHint`, `cameraInspectAnchor`, `selectionAnchor`, `articulationCandidate`.

## Limits and next slices

- Browser-only preview cannot access local GLBs. Use the native desktop shell.
- Raycast candidate positions use saved Model Orientation to correct the imported GLB's source axes; this still doesn't infer real propulsion, symmetry, turret geometry, joint axes, or physical articulation. A single-mesh source can still be examined and assigned exterior surface points.
- Coordinates are **source GLB-local, +Y up**. Downstream consumers must apply the approved orientation transform separately. Do not paste these coordinates directly into normalized Godot bounds fractions without conversion.
- Exposing an existing approved manifest to TWS-Video, normalizing its coordinates for Godot, supporting per-ship profiles, and introducing 3D visual tests are separate integration tasks.
- Next geometry analysis: component connectivity, material/UV segmentation, symmetry pairs, candidate normal/orientation, real triangle attachment, surface clearance and part-size heuristics. Add a confidence/evidence column.
- Optional local semantic model should be a *second opinion* on rendered multi-view images and analyzed geometry, never the primary source of numeric surface positions. Benchmark model accuracy, licensing and 12GB GPU footprint before integrating one.
- For actual moving mechanical parts, need mesh/component segmentation plus joint or pivot estimates, a reversible preview, and explicit acceptance. Do not cut original assets or generate fake animation.
- Model and texture ingestion remains owned by Imperatus-Assets with stable IDs, provenance, manifest validation, and LFS. Asset Forge should produce reviewable **proposals**, not silently mutate canonical source.

## Validation

From the Asset-Forge checkout on Windows, use its normal installer/development launcher and check that the tool opens in the desktop shell. Load a known GLB, select and relocate a point, approve it, save, reopen, and verify the coordinate and approval persist.

Rust/Tauri and WebGL runtime, along with the heavy 1.5M-triangle ship performance, have **not** been tested by the GitHub-only implementation environment. Model-rendering performance may be CPU-bound. Evaluate the optimized LOD first if the full original is slow.

## Model folder persistence and semantic orientation QA (2026-11-17)

The three GLB tools (**Model Orientation**, **Model Hardpoints**, and **Model Optimization**) now share a project-scoped remembered **model folder** via local app preferences. Model Orientation also remembers the chosen orientation-manifest path; the Hardpoints tool reads that same manifest when building suggestions. Switching screens should not reset the folder to a generic `assets\\models\\ships` default. Preferences are machine-local; asset manifests remain project-local.

Important regression test: load a reversed ship, fix and save its yaw in Model Orientation, switch to Model Hardpoints, then refresh models. The corrected orientation must visibly rotate the GLB; aft/port/starboard raycast candidates must be generated using the corrected coordinate frame, not source GLB axes. Confirm red -X arrows and green +X arrows represent the expected **canonical** port/starboard, and use the stern and bow camera view buttons. Existing approved hardpoints must remain unchanged until explicitly reviewed. Test screen switching, app relaunch, model change, and the folder path retained for the same linked project.

Note: A photo or particular ship's apparent left/right is not a substitute for an orientation manifest. For a viewer at the ship's stern looking toward canonical -Z, port is -X (viewer left) and starboard is +X (viewer right). A 180-degree source yaw correction can reverse both labels if applied only visually, so it is essential that both camera geometry and raycasts share the saved transform.

## QA correction: phantom saved reviews and reversed suggestions (2026-11-17)

A user saw a correct **yaw 180** ship preview, but candidate labels and XYZ values still reflected the backward model. The screen also said "Loaded saved hardpoints" despite the user never pressing Save. Prior logic silently replaced newly generated candidates with any matching existing record at `refs/assetForge/model-hardpoints.manifest.json`; the provenance of that record was never established. The presence of a record does **not** prove it was created by the current user.

**Updated behavior:**
- Source-local preview normalization is calculated with the orientation temporarily neutral, then approved yaw/pitch/roll is restored on the outer group. This keeps raycasts and model centering in consistent coordinate spaces, including the 180-degree yaw case.
- The current saved orientation always generates **fresh, unapproved** candidate points by default. A preexisting manifest is reported with its absolute path and recorded timestamp; its points are **not silently loaded**.
- An explicit **Restore Previous Review** button appears only for a record whose saved orientation exactly matches this model's current saved orientation. Older records without orientation metadata and mismatched records cannot be restored by this control; they remain untouched on disk. **Use Fresh Proposals** dismisses the warning without saving or changing files.
- **Save Reviewed Hardpoints** is the only operation that writes points. It now includes the current orientation in the manifest entry for stale-data detection, alongside the previous per-point approval flags. A backup and audit entry are retained.
- **Regenerate Current Proposals** refreshes unapproved points without changing explicitly approved draft points; it does not write to disk.

**QA on a reversed GLB**: Save yaw 180 in Model Orientation, go to Hardpoints, load/reload models. With the canonical -Z bow, the physically forward-most surface should be the **Bow surface (-Z)** proposal, not the aft deck. Port (-X) and starboard (+X) proposal points should follow the corrected ship hull, and their **source-local X coordinates may have opposite signs** because of the yaw correction. All fresh candidates should initially be unchecked. If a preexisting record is shown, note its path/timestamp; do not assume it was created in the current session. Do not save until the visible locations are correct.



## Interactive marker QA and local preview reload (2026-11-17)

User accepted four candidate hardpoints but reported the earlier editor was difficult to use: all markers looked alike and selection/movement was ambiguous. The first UX improvement now assigns **fixed, type-specific candidate IDs and colors** (cyan engine, red port, green starboard, gold forward inspection). The currently selected marker renders larger and its label is shown in a persistent **Moving:** line. Click a colored 3D marker to select it, then click the hull to move *that* candidate; row buttons also clearly show Select/Selected and their matching colors. Approval remains separate from selection and is only **in-memory** until **Save Reviewed Hardpoints** succeeds.

The top project toolbar also has **Reload UI**. This refreshes the desktop/web UI without stopping and recompiling the native Tauri Rust backend. It should not be mistaken for a full backend rebuild or a source-control pull. A full in-app dev rebuild/relaunch comparable to Song Harbor remains a follow-up task; avoid promising it is implemented by the UI reload alone.

Important integration: Saving hardpoints in a linked local project is not a Git upload. TWS-Video now has an explicit local importer (`scripts/import-ship-hardpoints.bat`) which selects approved Guard engine and port/starboard positions from this manifest and transforms them for the Godot model. See the TWS-Video README. Do not push source models to a public repo. The private asset publication tool will eventually live in Asset Forge, with separate review, commit, and publish actions.


## Fleet publication within Asset Forge (2026-11-17)

The hardpoint review manifest stores **multiple GLB model records** under one `models` object. Saving one model updates its record, not the other ships' records.

New in-app **Linked repository publication** section below the Hardpoint Analyzer:
1. After saving each reviewed ship, click **Review Git Status**. The app identifies the exact linked repository, absolute manifest path, total stored models, number containing approved points, manifest change status, and current branch Git status.
2. **Commit Hardpoint Manifest** creates a local Git commit containing only `refs/assetForge/model-hardpoints.manifest.json`; other staged changes are not intentionally included. This step does **not push**.
3. Read the branch status and acknowledge that **Push to Linked Repository** sends all currently unpushed commits on the linked branch, not just the manifest change. Push is a separate explicit click and uses the existing linked project Git credentials, remote and branch.
4. If the local repository is not configured, has no manifest, no approved points, lacks Git credentials, has an invalid remote or fails push, show a clear error; do not imply publication succeeded.

Git commits/pushes are not automatic when clicking **Save Reviewed Hardpoints**, checking Approve boxes, or changing models. The in-app publishing controls require the **Tauri desktop**; browser mode cannot commit Git repositories. The new Rust commands and React UI need Windows integration testing. The manifest remains in the linked private repository, never copied into public Asset-Forge sources.

**TWS-Video fleet handoff:** The TWS-Video `scripts/import-ship-hardpoints.bat` command now imports *all* approved model records into ignored local `.local/assets/ship-hardpoints-fleet.json`, displaying counts per ship. A separate legacy cache is refreshed only for the currently supported Gilded Caravan Guard engine-light rig. Importing other ships does not change which GLB is staged in Blackbox Gospel; model selection/staging for future videos is a distinct feature.
