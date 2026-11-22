# Running the read-only Imperatus model audit

The initial headless GLB fleet analyzer is [tools/model_audit.py](../tools/model_audit.py). It uses only Python 3's standard library and does **not** modify source or optimized GLB files.

In the local Asset Forge checkout, run from PowerShell (adjust actual checkout directories as needed):

```powershell
python .\tools\model_audit.py --assets-root "D:\Apps\Imperatus\Imperatus-Assets" --output-dir "D:\Apps\Imperatus\Imperatus-Assets\refs\assetForge\model-audit"
```

The paths above are an **example**, not a hard-coded default. Use the configured linked project folder from Asset Forge when integrating this command into its desktop UI.

The script scans `source/ships/**/*.glb` and `models/ships/**/*.glb` and writes:

- `model-audit.json`: source paths, file hashes, counts, per-primitive topology metrics, bounds, caveats, and filename-heuristic variant candidates.
- `model-audit.md`: human-readable fleet summary and initial triage.

Interpretation:

- `A_candidate`: multiple independently indexed islands *within GLB primitives*. A useful early signal, **not** proof of a coherent movable mechanical assembly.
- `C_candidate`: one island found; requires guided review, but may still have independent glTF nodes or material splits.
- `D`: missing/unsupported geometry or parsing error. Inspect `error` or per-primitive `status` before treating it as fused geometry.

**Important limitations:** This first-pass count is per primitive, not cross-primitive welded connectivity. It does not account for node transform world-space geometry, coincident-but-unwelded vertices, skinning, external buffers, sparse accessors, non-triangle primitive modes, symmetry, semantic labels, or AI inference. GLB counts and local bounds do not demonstrate articulation feasibility by themselves. High-poly meshes may take time and memory in pure Python. If performance warrants, upgrade the core analyzer to a native/NumPy/Trimesh backend.

## Acceptance and next steps

1. Run the audit locally against the private asset checkout and confirm source and optimized folders are covered.
2. Review counts/errors and select representative Gilded Caravan Guard, Keepshield Line Frigate, Slayer Cruiser plus A/C/D extremes.
3. Build the visual pass in Asset Forge: color-by-primitive, color-by-island, selectable component hierarchy, candidate symmetry overlays and side-by-side original/optimized previews. Compare in the approved orientation frame.
4. Manually record useful mechanical groupings (engine, turret, barrel, antenna, etc.) and evaluate how many are actually separable without geometry cutting.
5. Use difficult cases as a benchmark for ComfyUI/local segmentation models and for joint/pivot inference.
6. Only then graduate A/C/D topology triage to evidence-backed mechanical separation classifications.

Do not automatically commit or publish audit artifacts, or write generated geometry over existing originals. Confirm paths and review output before publication.

See [model-structure-research-roadmap.md](model-structure-research-roadmap.md) for the full hybrid geometry, AI, and articulation roadmap.
