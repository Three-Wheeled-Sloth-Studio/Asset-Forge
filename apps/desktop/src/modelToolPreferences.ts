// Shared per-project location for model tools. These are local UI preferences,
// not portable model/asset manifests.
const defaultFolder = "assets\\models\\ships";
const defaultOrientationManifest = "refs\\assetForge\\ship-model-orientation.manifest.json";

function storageKey(projectPath: string, item: string): string {
  return "asset-forge:model-tools:" + encodeURIComponent(projectPath.toLowerCase()) + ":" + item;
}

function readPreference(projectPath: string, item: string, fallback: string): string {
  try {
    return window.localStorage.getItem(storageKey(projectPath, item)) || fallback;
  } catch {
    return fallback;
  }
}

function writePreference(projectPath: string, item: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey(projectPath, item), value);
  } catch {
    // Project tools still work with in-memory state if storage is unavailable.
  }
}

export function getModelFolder(projectPath: string): string {
  return readPreference(projectPath, "model-folder", defaultFolder);
}

export function setModelFolderPreference(projectPath: string, folder: string): void {
  writePreference(projectPath, "model-folder", folder);
}

export function getOrientationManifest(projectPath: string): string {
  return readPreference(projectPath, "orientation-manifest", defaultOrientationManifest);
}

export function setOrientationManifestPreference(projectPath: string, path: string): void {
  writePreference(projectPath, "orientation-manifest", path);
}
