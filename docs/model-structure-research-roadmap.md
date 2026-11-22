# Model Structure, Segmentation, Articulation, and Hardpoints: Research and Roadmap

Status: research and proposed architecture, 2026-11-22. No implementation or model-quality claim is implied by this document.

## Objective

Turn imported GLB assets into reviewable, structured mechanical assets with:

- Guided or automated component segmentation/decomposition.
- Guided or automated rigid mechanical articulation, including pivots, joint axes, limits, and motion preview.
- Component-relative, oriented, validated hardpoints.
- A reversible workflow that retains original and optimized geometry and records decisions in portable manifests.

The canonical source is Imperatus-Assets. Asset Forge is the generic local-first analysis, authoring, review, and export tool. Imperatus and other consumers define runtime behavior.

## Current foundation

Asset Forge already includes model orientation manifests, a Three.js-based GLB hardpoint viewport, surface-raycast suggestions, interactive point relocation and explicit approvals, per-model review manifests, and linked-repository review/commit/push flows. The preview uses approved orientation before raycasting. Coordinates in the hardpoint manifest remain *source-GLB-local*, with the orientation applied separately by downstream consumers. The canonical oriented frame is -Z forward, +Y up, -X port, +X starboard.

The existing model optimization workflow stages derivatives and allows original/optimized comparison. Its geometry may have substantially different topology from original meshes. Segmentation IDs and hardpoint face references must not be assumed to transfer unchanged between variants.

See [model-hardpoints.md](model-hardpoints.md), [model-orientation-tool.md](model-orientation-tool.md), [model-optimization-tool.md](model-optimization-tool.md), and [handoff-manifests.md](handoff-manifests.md).

## Technology assessment

| Option | Proposed use | Evaluation |
| --- | --- | --- |
| Three.js (existing viewport) | Interactive selection, visual overlays, axis/pivot manipulation, motion previews, raycasts | Reuse directly |
| Blender Python API / BMesh | Connected component separation, mesh manipulation, pivots, hierarchical GLB export, optional repair | Strong first export backend; discover configured Blender executable |
| Trimesh | Offline connected components, bounds, symmetry and geometric analysis | Strong lightweight analysis candidate |
| Open3D | Point-cloud features, clustering and geometric registration | Useful if geometry-based proposals need deeper analysis |
| glTF / GLB node hierarchy | Portable rigid component hierarchy and local transforms | Preferred runtime interchange format |
| Godot 4 | Runtime import and mechanical animation acceptance tests | Consumer/QA integration, not required for editing |
| ComfyUI | Orchestrate local image/3D model inference, multi-view rendering/segmentation workflows, and model comparisons | Explicitly in scope; reuse existing Comfy integration patterns |
| Local vision-language / segmentation models | Label likely engines, turrets, hatches, barrels and other candidate components | Active evaluation track, not postponed indefinitely |
| Articulate-Anything and PartNet-Mobility | Research reference for part segmentation, joint inference, simulation-based refinement | Benchmark applicability to spacecraft; do not assume research benchmark performance transfers |

References: [Blender Python API](https://docs.blender.org/api/current/), [Trimesh](https://trimesh.org/), [Open3D](https://www.open3d.org/docs/release/), [glTF 2.0](https://registry.khronos.org/glTF/), [ComfyUI](https://github.com/comfyanonymous/ComfyUI), [Articulate-Anything](https://articulate-anything.github.io/), [PartNet-Mobility](https://sapien.ucsd.edu/browse).

## Explicit automation posture

**We are willing to use ComfyUI, download relevant model weights, and run local inference when this yields more useful automation.** The strategy is hybrid rather than geometry-only. Reuse the existing ComfyUI integration and the user's local Blender/Godot/ComfyUI/Ollama environment before designing another orchestration layer.

Candidate AI paths:

1. Render multiple canonical orthographic and oblique views plus a geometry/component overlay.
2. Use a local vision-language model to propose semantic part identities and parent-child grouping.
3. Use segmentation models on rendered views to identify target regions, project results back to triangles, then reconcile inconsistent views.
4. Use an articulation-oriented model or algorithm to propose joint types, axes, and pivots from geometry plus semantic cues.
5. Validate numeric output against actual mesh geometry; let the user refine and approve the proposal.
6. Use ComfyUI workflows where suitable for image generation, multi-view model inference, or segmentation. Standalone Python inference is acceptable when simpler or better supported.

Specific model choices, licenses, memory usage, offline availability and quality must be tested, not assumed. The primary workstation has RTX 4070 12 GB VRAM and 96 GB RAM. Provide CPU/low-VRAM options or clear capability warnings; avoid blocking the entire workflow on heavyweight inference. A generated model label or image mask is *evidence*, never authoritative XYZ or a license to change geometry.

Benchmark candidate techniques on actual Imperatus-Assets source and optimized GLBs, including single fused meshes and high-triangle-count ships. Measure selection precision, usable decomposition rate, pivot/axis accuracy, manual correction time, inference duration and VRAM use. Record license/dependency constraints for redistribution.

## Architecture: one component graph

Create a unified, versioned *model structure manifest*, keyed by stable asset identity and source revision/hash. It should record:

- Components: stable IDs, labels, semantic category, parent IDs, source mesh/primitive/face selection references, local transforms, confidence/evidence and approval state.
- Joints: parent/child component IDs, fixed/revolute/prismatic type, local pivot and axis, rest pose, angular/linear limits, optional speed/acceleration and collision envelope.
- Hardpoints: stable IDs, type, label, parent component ID, local position and orientation, optional radius/clearance, approval, evidence and attachment method.
- Provenance: source GLB, source/optimized variant, mesh fingerprint, orientation revision, proposal method/model/workflow version, editor review, timestamp and audit log.
- Derived exports: staged artifact paths and validation results, without overwriting canonical source.

Preserve compatibility with the existing `model-hardpoints.manifest.json` and `ship-model-orientation.manifest.json`. Do not silently reinterpret existing source-local coordinates. Define explicit transforms between source local, canonical oriented, component local, and exported GLB hierarchy. A hardpoint attached to a moving gun barrel must follow the barrel through its parent transform.

Keep semantics generic: a physical mount can be labeled weapon mount, but game-specific equipment, damage or fire-control rules belong to the consuming game. Avoid a proliferating dictionary of nearly identical component types; favor types plus parameters.

## Segmentation approaches

1. **Structural**: inspect GLB node and mesh boundaries; find disconnected face islands. Safe automatic proposals.
2. **Geometric**: cluster by materials, normals, curvature, proximity, bounding shapes, symmetry, repeated forms and contact regions. Suggested groupings need review.
3. **Guided**: click/select connected faces, expand by feature similarity, mirror selection, lasso/paint, and optional plane/volume cut.
4. **Semantic / model-assisted**: combine multi-view masks, geometric components and vision-language labels; surface confidence and evidence. Ambiguous selections remain editable.
5. **Destructive decomposition only in derivatives**: handle cap surfaces, normals, UV/material continuity, contact geometry, and validation; preview the result first.

Generated/optimized topology may invalidate face-index attachment. Favor stable semantic components and local coordinates; if triangle barycentric anchoring is introduced, version and verify against a particular mesh fingerprint.

## Articulation workflow

Initial scope: rigid transforms in a GLB node hierarchy, not skin deformation. Support fixed, revolute and prismatic joints; compound mechanisms through nested joints.

- Infer candidate mechanical axes and pivots from circular geometry, symmetry, principal axes and contact surfaces.
- Offer editable gizmos, numeric transforms, limit controls, rest-pose selection and reversible motion previews.
- Include guided presets: turret (yaw + optional barrel elevation), gimbaled engine, antenna/sensor, hinged hatch/landing gear and telescoping mechanism.
- Check swept motion against surrounding hull and neighboring components. Distinguish collision warnings from impossible motion.
- Keep suggested joints unapproved until the user accepts them.

A good initial acceptance test is a turret whose base yaws, barrel elevates and muzzle hardpoint follows the barrel in local space.

## Hardpoint management

Build on the current point editor with:

- Position **and orientation** (direction/quaternion or equivalent), labels, editable radius and visible surface normals.
- Attachment to a specific component/joint, rather than exclusively to the ship root.
- Mirrored pairs, repeated mounts, grouped editing, filters and status coloring.
- Surface/triangle anchoring with mesh-version safeguards; clearance and overlap validation.
- Visual exhaust cones, weapon firing vectors/arcs and mount compatibility envelopes.
- Explicit proposal/approved/stale state, backed by orientation and model revision checks.
- Preserve the existing no-silent-save, explicit restore/review/commit/push behavior.

UI: compact, icon-first, clear selected/moving item, progress and cancellation for costly operations, obvious orange/red required actions and green completion. Do not force manual CLI steps when an in-app workflow can invoke configured tools safely.

## Incremental delivery

### P0: asset feasibility audit

- Sample actual source and optimized ship GLBs, including already-reviewed Gilded Caravan Guard, Keepshield Line Frigate and Slayer Cruiser when present.
- Report node/mesh/primitive counts, material distribution, connected islands, symmetry, face counts, optimization impact, inferred part prospects, and representative screenshots.
- Determine what portion of candidate articulation requires actual mesh cutting versus hierarchy changes.
- Test source/derivative coordinate and hardpoint compatibility.
- Do not alter canonical assets.

### P1: Model Structure V1

- Shared component IDs/hierarchy manifest and validation.
- Connectivity-based candidate segmentation and selectable component tree.
- Basic grouping, naming, parent assignment and symmetry suggestions.
- Joint gizmo for one revolute joint plus motion preview.
- Component-relative oriented hardpoint following its moving parent.
- Save/restore, source revision tracking, non-destructive staged export.
- QA with a ship turret or suitable mechanical proxy.

### P2: assisted decomposition and templates

- Guided face selections; optional mirror/lasso/plane segmentation.
- Blender-backed generated copies for real mesh separation where needed.
- Turret, gimbal, hatch, engine and other joint templates.
- Clearance and swept-motion checks; hardpoint batch and compatibility previews.
- Original/optimized component mapping validation.

### P3: model-assisted proposals (investigate in parallel with P1/P2)

- ComfyUI-integrated local multi-view segmentation/classification pipeline and standalone model alternatives.
- Compare at least two approaches on representative ships; review accuracy, correction time, hardware cost, licensing and reproducibility.
- Add AI proposals into the same review system, not a competing source of truth.
- Investigate articulation-inference research systems only when their output is usable on our mesh corpus.

## Definition of done for first prototype

A representative ship loads with approved orientation; components can be discovered or designated, named and parented; a turret can rotate independently without damaging source geometry; a muzzle hardpoint moves correctly with the articulated barrel; the manifest can be reopened; staged GLB motion and transform behavior can be verified in Godot; source and optimized variants are not silently conflated.

## Decisions pending actual asset audit

- How many meshes are fused and how clean their geometric boundaries are.
- Whether Blender automation is sufficient for the first segmentation export or a dedicated geometry worker adds value.
- Which locally runnable AI models work acceptably within available VRAM.
- Whether a single model structure manifest should reference the existing hardpoint manifest or be introduced as a compatible schema evolution.
