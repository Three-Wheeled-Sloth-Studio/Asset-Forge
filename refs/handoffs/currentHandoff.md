# Current Handoff

## Non-fast-forward hardpoint publication recovery (2026-11-17)
- User's Asset Forge Push to Linked Repository for Imperatus-Assets main was rejected (fetch first). No remote overwrite occurred; local hardpoint commit remains.
- Added in-app **Integrate Remote Main** recovery, only shown after a push failure containing non-fast-forward/fetch-first/rejected-main indicators. It requires a second explicit checkbox and retains the separate Push confirmation.
- Rust handler checks local branch is main and tracked tree is clean, fetches origin/main, and runs a normal merge when remote is ahead. No force push, reset, stash or automatic remote publication. A conflicting merge is automatically aborted when possible and surfaced as a clear error; local commits are preserved.
- Validation outstanding: Windows Tauri relaunch, typecheck and actual linked-repo divergence workflow. Do not claim user's failed push is already recovered. After pulling Asset Forge main, reopen the desktop app and use the recovery control, then review and approve Push separately.
- Future improvement: display ahead/behind counts before the initial Push so users can reconcile proactively, and add a guided conflict resolver if truly overlapping changes occur.


## Fleet publication UI and TWS-Video fleet bridge (2026-11-17)
- User reviewed THREE ships in Asset Forge. The previous TWS-Video importer reported only Gilded Caravan Guard because it intentionally filtered to the current song's ship. This was a tooling limitation, not evidence that the other reviews were lost.
- Asset Forge hardpoints now contains **Linked repository publication** at the bottom of the Model Hardpoints screen: Review Git Status -> Commit Hardpoint Manifest -> separately confirmed Push to Linked Repository. It reviews the complete `refs/assetForge/model-hardpoints.manifest.json` (all ships), shows linked repo, branch, model and approved-model count; commit is scoped to just the manifest via `git commit --only`. Push reuses the app's existing linked-project Git sync and requires explicit checkbox approval. Warns push can include *other unpushed branch commits*. Saving hardpoints is not a commit or push. In-memory edits invalidate prior push confirmation. On error, display Git failure.
- Rust commands `review_hardpoint_repo`, `commit_hardpoint_repo` are registered, alongside pre-existing `sync_external_project` for the explicit push. No credentials stored in UI or public repo; linked private checkout remains authoritative.
- TWS-Video importer now writes every reviewed model's approved points into ignored local `.local/assets/ship-hardpoints-fleet.json`, and outputs per-model counts. It separately updates the Guard-only light cache when a suitable Guard record is found. **It does not switch the video ship model**; per-ship model staging and render selection remain follow-up.
- Windows QA: pull main, restart Asset Forge due to Rust changes (`.\\launch-asset-forge.cmd`), navigate Model Hardpoints in the linked Imperatus-Assets project, Review Git Status (expect 3 approved models), Commit Hardpoint Manifest, verify result, explicitly confirm Push. This should only be done when ready to publish all reviewed changes. Then pull the linked checkout on any other workstation before importing it into TWS-Video.
- Do not claim runtime success until local Tauri build and Git status/commit/push checked. No remote Git action was executed by this change.


## Asset Forge hardpoint usability and local TWS bridge (2026-11-17)
- User reports current first-pass hardpoint UI is poor: identical markers, no obvious active selection, unclear how to move a specific point. User approved all four candidates but may not have clicked **Save Reviewed Hardpoints**, so they are not necessarily persisted. Approval must be explicitly distinguished from Save; checked boxes alone remain in-memory.
- Updated `apps/desktop/src/HardpointAnalyzer.tsx` to use permanent per-candidate colors: engine cyan, port red, starboard green, bow/inspection gold; active marker rendered larger. Direct click on a colored 3D marker selects it without moving; subsequent click on hull moves the selected marker, unapproving its previous coordinate. Matching colored dots and Select/Selected labels in table, persistent `Moving: <name>` notice, and explicit unsaved approval status. No private GLBs changed.
- Added rail **Reload UI** action; it refreshes frontend while preserving selected project and tool in session state. This is **not a Rust/Tauri rebuild or binary upgrade**. Full in-app build/relaunch akin to Song Harbor remains a separate follow-up feature; use `.\\launch-asset-forge.cmd` after pulling native backend changes.
- TWS-Video now offers explicit reviewed-hardpoint import: from TWS-Video checkout, run `.\\scripts\\import-ship-hardpoints.bat "<linked-project>\\refs\\assetForge\\model-hardpoints.manifest.json"`. Only approved engine and two named nav points are imported to ignored local cache, then used in the existing cinematic Godot rig via source-local coordinate transform. Neither Git push nor private asset distribution occurs. Validate ship geometry at 1080p detail first. Source handoff docs in TWS-Video README/handoff.
- Asset Forge remains the intended UI for a future **private** GLB/texture/material import + review + commit/publish flow; its separate publisher is not yet implemented. Repository-linked project data and private binaries never go into the public Asset Forge repo.
- Windows Tauri/TypeScript and actual 3D marker hit-testing still need local QA.


## Hardpoint QA: misleading persisted state and raw/local axes (2026-11-17)
- User's latest screenshot shows yaw 180, correct visual orientation and persistent model folder, **but candidate points still appear reversed and forward inspection is at the stern**. UI claimed "Loaded saved hardpoints" although user never clicked Save. This was caused by the app's unconditional preference for any matching record found in `refs/assetForge/model-hardpoints.manifest.json`, including legacy/unattributed records. It does not prove the user saved anything. Existing file provenance is unknown.
- Fixed loader to return `{found, manifestPath, updatedAt, savedOrientation, points}` rather than treating file data as automatically approved. UI now uses **fresh, unapproved candidates by default**; it reports any matching existing record explicitly with its path and timestamp and never silently loads it. Restoring an old record is opt-in and only allowed when it contains the **same saved orientation**. Legacy records without orientation cannot be restored with the button. No existing file is deleted.
- Fixed preview normalization: derive raw bounding-box center/scale with the orientation temporarily neutral, then restore approved transform on the outer group. This prevents a rotated world-box center from being re-used as a local translation. Port = canonical -X, starboard = +X, bow = -Z, aft = +Z. With yaw 180 the **source-local XYZ signs can differ** from canonical signs; do not infer side from source-local X sign alone.
- Saving now stamps the model's current orientation alongside source-local hardpoints; approval remains per-point and the *only* save action is explicit. Updated `docs/model-hardpoints.md`. No private source GLBs or existing hardpoint manifests were changed by the code update.
- New intended QA: relaunch Asset Forge, load Model Hardpoints with Gilded Caravan Guard yaw 180. Verify **new unsaved, unchecked points**, forward marker at the actual pointed bow, port/starboard on actual corrected sides. If an existing record appears, inspect its path and click `Use Fresh Proposals`; never assume user created it. Do not Save until geometry is right. Windows desktop build and visual behavior still unverified here.
- Private asset import / Git LFS publishing UI belongs in **Asset Forge** (existing project URL, local checkout and sync), per user correction. Imperatus-Assets remains the private canonical destination/validation contract, **not** a second uploader UI. Plan documented in `Asset-Forge/docs/private-asset-publication.md`. Implement only as separately authorized reviewed staging/commit/publish actions.


## Model Hardpoints QA fixes (2026-11-17)
- User provided a screenshot of Gilded Caravan Guard in Asset-Forge; its raw GLB was facing backward until corrected in Model Orientation. Even after that correction, the original hardpoint tool still generated 'port' from raw GLB -X, so the starboard side was incorrectly labeled. The model folder also reset when switching tools.
- **Fix:** Hardpoint preview now reads each model's saved yaw, pitch, roll and scale from the same project-local orientation manifest as Model Orientation. The scene applies this orientation *before* raycasting candidate positions, in a separate parent group from preview-only mesh normalization. Candidate directions use canonical right-handed axes: -Z forward, +Y up, -X port, +X starboard. Points remain saved in source-GLB-local coordinates using root.worldToLocal, preserving the existing downstream coordinate contract. This corrects both visible orientation and semantic side selection; it does not infer actual engine geometry.
- Added explicit View stern, View bow, View port, View starboard, View top camera presets and colored canonical direction arrows. UI displays saved orientation, explains model versus preview coordinates, and provides **Refresh Unapproved Suggestions**. Existing approved points are deliberately kept rather than silently repositioned or relabeled when orientation changes.
- **Persistence:** new `apps/desktop/src/modelToolPreferences.ts` stores model folder under project-specific local-storage key; shared by Model Orientation, Model Hardpoints and Model Optimization. Orientation manifest selection is also remembered and used by Hardpoints. Switching screens or relaunching should retain the last folder for each linked project, without writing machine preferences into portable asset manifests.
- Docs updated: `docs/model-hardpoints.md` and `docs/tooling-checklist.md`. Existing reviewed hardpoint manifests and GLB files are untouched.
- **QA still required on Windows:** `git pull origin main`; `.\\launch-asset-forge.cmd`; select same linked project and confirm model folder survives tool switch and app relaunch; open corrected ship, verify orientation y/p/r, click **Load Models / Refresh Orientation**, use port/starboard camera presets and regenerated unapproved suggestions, then approve only physically correct candidate locations. Check that already-approved points remain unchanged.
- No Rust/Tauri or desktop WebGL runtime checks performed from this GitHub-only session. Build/typecheck need local validation; if any launch error, capture exact message and fix. Future improvement: record orientation revision with each hardpoint review to detect stale approvals, add editable labels and surface-normal axes.



## Current focus
Durable project memory has moved into the `refs/` structure. The latest work filled out project identity, module ownership, architecture boundaries, handoff/logging structures, validation commands, and testing criteria.

The newest implementation adds a generic Asset Handoff tool to the desktop UI. It initializes `refs/assetForge` in the linked game project, captures asset needs in `asset-needs.manifest.json`, attaches source assets into `asset-assignments.manifest.json`, optionally copies selected assets into the linked game folder, and regenerates `asset-handoff-to-game-agent.md` for coding-agent consumption.

## Relevant files
- `refs/project.yaml`
- `refs/architecture/boundaries.yaml`
- `refs/architecture/modules.yaml`
- `refs/planning/decisions.yaml`
- `refs/planning/roadmap.yaml`
- `refs/planning/todos.yaml`
- `refs/architecture/integrationMap.yaml`
- `refs/implementation/fileMap.yaml`
- `refs/testing/acceptanceCriteria.yaml`
- `refs/testing/validationCommands.yaml`
- `refs/handoffs/implementationLog.yaml`
- `docs/generic-asset-handoff.md`
- `docs/handoff-manifests.md`

## Decisions already made
- Asset Forge/Asset Foundry is local-first, with hosted account/project sync planned but not required for core workflows.
- `refs/architecture` owns durable architecture boundaries.
- `refs/planning` owns roadmap, todos, modules, decisions, and integration maps.
- `refs/handoffs` owns current handoff state and implementation logs.
- `refs/testing` owns durable acceptance criteria and validation commands.
- Portable project metadata and machine-local config/bindings must stay separate.
- Generated assets must stage first, then review/promote with manifests and audit logs.
- Generic game asset requests should flow through `refs/assetForge/asset-needs.manifest.json`; Asset Forge responses should flow back through `refs/assetForge/asset-assignments.manifest.json` and `asset-handoff-to-game-agent.md`.

## Known blockers
- `rust-msvc-sdk-linker`: previous notes say `cargo check` can be blocked on machines missing MSVC/Windows SDK `msvcrt.lib`.
- `cargo check` on 2026-06-04 still fails before app-crate checking with `LINK : fatal error LNK1104: cannot open file 'msvcrt.lib'`.
- Hosted identity, entitlement, and provider sync are planned but not implemented.
- Some integration config files are planned but do not exist yet under `refs/integrations`.

## Safe next steps
- Use `refs/project.yaml` and `refs/architecture/modules.yaml` before implementing new modules.
- Use `refs/architecture/boundaries.yaml` to check whether data belongs in portable project files, machine-local app data, or hosted services.
- Add missing acceptance criteria in `refs/testing/acceptanceCriteria.yaml` before starting larger workflow changes.
- Keep implementation logs in `refs/handoffs/implementationLog.yaml` when substantial changes land.

## Do not change
- Do not store credentials, provider tokens, Steam partner keys, GitHub tokens, or machine-only secrets in project files, refs, docs, examples, or tracked source.
- Do not overwrite source assets by default.
- Do not make hosted services required for core local workflows unless a feature is explicitly cloud-only.

## Validation commands
- `npm run typecheck`
- `npm run build`
- `cargo-fmt --check`
- `npm run tauri:build`
- `cargo check` from `apps/desktop/src-tauri` when the Rust/MSVC environment is healthy.

## Notes for next agent
- Documentation and project memory should now land in the appropriate `refs/` structure first; legacy docs can summarize but should not be the only source of durable planning state.
- If a referenced config file does not exist yet, mark it as planned instead of implying it is available.
