# Private Asset Publication from Asset Forge

## Decision (2026-11-17)

Use the existing **Asset Forge desktop app** as the UI for preparing and publishing new private assets into a linked private repository such as **Imperatus-Assets**. It already stores a project-specific local checkout and GitHub repository URL and supports local Git status/pull/push. A separate frontend in the private repo would duplicate project selection and authoring workflows.

**Security boundary:** Asset Forge is public code and carries *no private asset binaries*, tokens, production meshes, or embedded secrets in its repository. Files are loaded from the user's existing local checkout and staged privately. Git authentication stays local, in Git/Git Credential Manager or equivalent. The destination is the selected private repository, not an Asset Forge service or remote inference endpoint.

## Intended integrated workflow

1. Pick a linked private target project and select local source files (GLB, texture maps, material files), plus asset type, stable ID, ownership, original provenance, permitted redistribution and optional parent/source asset ID.
2. Inspect all local input files and dependencies. Validate GLB structure, texture references, ownership declarations, file size, SHA256, and candidate Git LFS tracking. Detect duplicates by content, not only filename.
3. Present a full **import plan**: source/derived classification, target paths, new/changed files, manifest diff, Git status, expected LFS storage and conflicts. Require explicit acknowledgement of any model/material dependencies or missing licensing metadata. Preview when feasible.
4. On **Approve Import**, copy to the private linked checkout's staging paths and produce/update canonical asset manifests, with backup/rollback metadata. Do not silently overwrite or erase existing assets.
5. Provide separate **Validate**, **Commit**, and **Publish** controls with clear results and errors, using the linked private repository's existing scripts/contracts (Imperatus-Assets: `scripts/validate-assets.bat` and `scripts/publish-assets.bat`). Expose dirty tree, remote branch mismatch, LFS health, authentication and conflict state. An explicit user action is required before every remote push.
6. Preserve an auditable record of what was imported and published, including hashes, manifest revision, status, commit and repository identity.

## Architecture and scope

- Asset-Forge: UI, local source selection, provenance inputs, review/diff, portable staging plan, approvals, configured project Git workflow.
- Imperatus-Assets: authoritative stable-ID and source/derived manifests, validation, Git LFS rules and physical private binaries.
- Asset-Workshop: optional local generative texture candidates; generated results remain unapproved source material until deliberately imported.
- TWS-Video: read-only consumer of *approved* versioned assets with publication-safe licensing.

No new importer action has been implemented yet. The first delivery should only stage and validate a single explicit file and its manifest, then expand to dependencies and batch imports after real QA. Do not publish any private model data to GitHub issues or public repositories when troubleshooting.

## Relation to hardpoints

Approved geometry-only or future AI-assisted hardpoint proposals live initially in the **linked project's** `refs/assetForge/model-hardpoints.manifest.json`. The same import workflow can later promote them into canonical per-asset manifests **only after orientation compatibility and source-local-to-canonical coordinates are validated**. Do not automatically promote the current first-pass source-local candidates.
