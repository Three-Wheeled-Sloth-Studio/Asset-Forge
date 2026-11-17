import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { getModelFolder, setModelFolderPreference, getOrientationManifest } from "./modelToolPreferences";

type ModelTransform = { yawDegrees: number; pitchDegrees: number; rollDegrees: number; scale: number };
type Model = { modelPath: string; fileName: string; transform: ModelTransform };
type Catalog = { models: Model[] };
type Kind = "enginePort" | "maneuverThruster" | "navigationLight" | "weaponMountHint" | "cameraInspectAnchor" | "selectionAnchor" | "articulationCandidate";
type Point = { id: string; kind: Kind; label: string; position: [number, number, number]; approved: boolean; method: string };
type ViewPreset = "stern" | "bow" | "port" | "starboard" | "top";
type RepoStatus = {
  repository: string; manifestPath: string; modelCount: number;
  approvedModelCount: number; changeStatus: string; branchStatus: string;
};
type GitActionResult = { command: string; output: string };
type StoredReview = { found: boolean; manifestPath: string; updatedAt: string | null; savedOrientation: ModelTransform | null; points: Point[] };
function sameOrientation(a: ModelTransform | null, b: ModelTransform): boolean {
  return a !== null && (["yawDegrees", "pitchDegrees", "rollDegrees", "scale"] as const)
    .every((key) => Math.abs(a[key] - b[key]) < 0.0001);
}

const types: Kind[] = ["enginePort", "navigationLight", "maneuverThruster", "weaponMountHint", "cameraInspectAnchor", "selectionAnchor", "articulationCandidate"];

// Directions are in the canonical, *oriented* frame, not the source GLB axes.
// With -Z forward and +Y up, port is -X and starboard is +X.
const markerColors: Record<string, number> = {
  "engine-port": 0x2fb8ff,
  "port-light": 0xff5e68,
  "starboard-light": 0x4dde91,
  "inspection": 0xf6c55d,
};
function markerColor(id: string): number { return markerColors[id] ?? 0xb695ff; }
function markerCss(id: string): string { return "#" + markerColor(id).toString(16).padStart(6, "0"); }

const proposals: Array<[string, Kind, string, THREE.Vector3]> = [
  ["engine-port", "enginePort", "Aft surface (engine hint)", new THREE.Vector3(0, 0, 1)],
  ["port-light", "navigationLight", "Port hull (-X)", new THREE.Vector3(-1, 0, 0)],
  ["starboard-light", "navigationLight", "Starboard hull (+X)", new THREE.Vector3(1, 0, 0)],
  ["inspection", "cameraInspectAnchor", "Bow surface (-Z)", new THREE.Vector3(0, 0, -1)]
];

export function HardpointAnalyzer({ projectPath }: { projectPath: string }) {
  const [folder, setFolder] = useState(() => getModelFolder(projectPath));
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState("");
  const [points, setPoints] = useState<Point[]>([]);
  const [activeId, setActiveId] = useState("engine-port");
  const [status, setStatus] = useState("Load models, then review proposals from the saved model orientation.");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);
  const [repoMessage, setRepoMessage] = useState("");
  const [pushApproved, setPushApproved] = useState(false);
  const [remoteOutOfDate, setRemoteOutOfDate] = useState(false);
  const [mergeApproved, setMergeApproved] = useState(false);
  const [storedReview, setStoredReview] = useState<StoredReview | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const pointsRef = useRef(points);
  const activeRef = useRef(activeId);
  const viewPresetRef = useRef<(view: ViewPreset) => void>(() => {});
  const regenerateRef = useRef<() => void>(() => {});
  const updatePointRef = useRef<(value: [number, number, number]) => void>(() => {});

  pointsRef.current = points;
  activeRef.current = activeId;
  updatePointRef.current = (position) => {
    setPoints((items) => items.map((point) =>
      point.id === activeRef.current ? { ...point, position, approved: false, method: "surface-click" } : point));
    setRepoStatus(null);
    setPushApproved(false);
  };

  const selectedModel = models.find((model) => model.modelPath === selected) ?? null;

  async function load() {
    setBusy(true);
    setReady(false);
    setStoredReview(null);
    setStatus("Loading model catalog...");
    try {
      const result = await invoke<Catalog>("list_ship_model_orientations", {
        request: { projectPath, modelFolder: folder, manifestPath: getOrientationManifest(projectPath) }
      });
      setModels(result.models);
      setSelected((current) => result.models.some((model) => model.modelPath === current)
        ? current : result.models[0]?.modelPath ?? "");
      if (!result.models.length) setStatus("No GLB models found in this folder.");
    } catch (error) { setStatus("Cannot load models: " + String(error)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    setFolder(getModelFolder(projectPath));
    setModels([]);
    setSelected("");
    setPoints([]);
    setReady(false);
    setStoredReview(null);
  }, [projectPath]);

  useEffect(() => {
    const host = viewRef.current;
    if (!host || !selectedModel || !("__TAURI_INTERNALS__" in window)) return;
    const width = Math.max(320, host.clientWidth);
    const height = 480;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x131a20);
    const camera = new THREE.PerspectiveCamera(43, width / height, 0.01, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    host.replaceChildren(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    scene.add(sun);

    // Orientation is deliberately separate from preview normalization, so
    // clicking a surface still saves original source-local GLB coordinates.
    const oriented = new THREE.Group();
    const normalizer = new THREE.Group();
    scene.add(oriented);
    oriented.add(normalizer);
    const transform = selectedModel.transform;
    oriented.rotation.set(
      THREE.MathUtils.degToRad(transform.pitchDegrees),
      THREE.MathUtils.degToRad(transform.yawDegrees),
      THREE.MathUtils.degToRad(transform.rollDegrees),
      "XYZ"
    );
    oriented.scale.setScalar(Math.max(0.05, transform.scale || 1));

    const markers = new THREE.Group();
    scene.add(markers);
    const visibleMarkers = new Map<string, THREE.Mesh>();
    const sharedMarkerGeometry = new THREE.SphereGeometry(0.024, 10, 8);
    const ray = new THREE.Raycaster();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    let gltfRoot: THREE.Object3D | null = null;
    let disposed = false;
    let readyGeometry = false;
    let candidateSuggestions: Point[] = [];
    let dragging = false, moved = false, startX = 0, startY = 0;
    let yaw = 0.7, pitch = 0.35, distance = 6.4;
    let frame = 0;

    // Visual orientation key: these fixed arrows represent the corrected ship
    // frame, *not* the often-backward source GLB frame.
    for (const [direction, color] of [
      [new THREE.Vector3(0, 0, -1), 0xffd679],
      [new THREE.Vector3(-1, 0, 0), 0xf07a7a],
      [new THREE.Vector3(1, 0, 0), 0x85de99]
    ] as Array<[THREE.Vector3, number]>) {
      const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(0, 0, 0), 2.1, color, 0.23, 0.10);
      scene.add(arrow);
    }

    function cameraPose() {
      camera.position.set(distance * Math.sin(yaw) * Math.cos(pitch),
        distance * Math.sin(pitch), distance * Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(0, 0, 0);
    }

    viewPresetRef.current = (view) => {
      const poses: Record<ViewPreset, [number, number]> = {
        stern: [0, 0.20], bow: [Math.PI, 0.20],
        port: [-Math.PI / 2, 0.20], starboard: [Math.PI / 2, 0.20],
        top: [Math.PI / 4, 1.38]
      };
      [yaw, pitch] = poses[view];
    };

    function sourcePosition(world: THREE.Vector3): [number, number, number] {
      const local = gltfRoot!.worldToLocal(world.clone());
      return [local.x, local.y, local.z];
    }

    function propose(root: THREE.Object3D): Point[] {
      // Raycasts operate on oriented geometry. Project-side naming cannot be
      // correct by using the raw GLB +/-X or +/-Z if yaw has been corrected.
      const bounds = new THREE.Box3().setFromObject(root);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 3;
      root.updateMatrixWorld(true);
      const suggestions: Point[] = [];
      for (const [id, kind, label, direction] of proposals) {
        ray.set(center.clone().addScaledVector(direction, radius), direction.clone().negate());
        const hits = ray.intersectObject(root, true);
        if (hits.length) {
          suggestions.push({ id, kind, label, position: sourcePosition(hits[0].point),
            approved: false, method: "oriented-axis-raycast" });
        }
      }
      return suggestions;
    }

    regenerateRef.current = () => {
      if (!readyGeometry) return;
      // Preserve user-approved locations. Explicitly refresh only suggestions.
      setPoints((current) => {
        const approved = current.filter((point) => point.approved);
        const remaining = candidateSuggestions.filter((candidate) =>
          !approved.some((point) => point.id === candidate.id));
        return [...approved, ...remaining];
      });
      setStatus("Regenerated current candidates; preserved only previously approved draft points. Nothing saved.");
    };

    setStatus("Loading GLB and saved orientation...");
    setReady(false);
    void invoke<number[]>("load_ship_model_preview", {
      request: { projectPath, modelFolder: folder, modelPath: selectedModel.modelPath }
    }).then((bytes) => {
      if (disposed) return;
      loader.parse(new Uint8Array(bytes).buffer, "", ({ scene: root }) => {
        if (disposed) return;
        gltfRoot = root;
        normalizer.add(root);
        root.updateMatrixWorld(true);
        // Compute the normalization in the source coordinate frame, before
        // applying the user's approved orientation to the outer group.
        oriented.rotation.set(0, 0, 0);
        oriented.scale.setScalar(1);
        scene.updateMatrixWorld(true);
        const sourceBounds = new THREE.Box3().setFromObject(root);
        const center = sourceBounds.getCenter(new THREE.Vector3());
        const dimensions = sourceBounds.getSize(new THREE.Vector3());
        const scale = 3.1 / Math.max(0.001, dimensions.x, dimensions.y, dimensions.z);
        normalizer.scale.setScalar(scale);
        normalizer.position.copy(center.multiplyScalar(-scale));
        oriented.rotation.set(
          THREE.MathUtils.degToRad(transform.pitchDegrees),
          THREE.MathUtils.degToRad(transform.yawDegrees),
          THREE.MathUtils.degToRad(transform.rollDegrees), "XYZ"
        );
        oriented.scale.setScalar(Math.max(0.05, transform.scale || 1));
        scene.updateMatrixWorld(true);
        candidateSuggestions = propose(oriented);
        readyGeometry = true;
        // Disable editing and saving until any existing record is checked.
        // Display fresh proposals by default. An existing file is not proof
        // that this user saved or approved those older coordinates.
        setPoints(candidateSuggestions);
        void invoke<StoredReview>("load_model_hardpoints", {
          request: { projectPath, modelFolder: folder, modelPath: selectedModel.modelPath }
        }).then((previous) => {
          if (disposed) return;
          setReady(true);
          setStoredReview(previous.found ? previous : null);
          if (previous.found) {
            const compatible = sameOrientation(previous.savedOrientation, transform);
            setStatus("Fresh candidates generated. Existing file found at " + previous.manifestPath +
              (previous.updatedAt ? " (timestamp " + previous.updatedAt + ")" : "") +
              ". Its data was NOT automatically loaded. " +
              (compatible ? "You may restore it explicitly." :
                "The saved orientation is absent or different: inspect before importing."));
          } else {
            setStatus(candidateSuggestions.length
              ? "New unsaved proposals from the saved orientation. No persisted record for this model."
              : "No surface intersections found. Check model geometry and orientation.");
          }
        }).catch((error) => {
          if (disposed) return;
          setStoredReview(null);
          setPoints([]);
          setReady(false);
          setStatus("ERROR: Cannot verify existing hardpoint records: " + String(error));
        });
      }, (error) => setStatus("ERROR: GLB parse failed: " + String(error)));
    }).catch((error) => setStatus("ERROR: GLB loading failed: " + String(error)));

    function pointerDown(event: PointerEvent) {
      dragging = true; moved = false;
      startX = event.clientX; startY = event.clientY;
      host!.setPointerCapture(event.pointerId);
    }
    function pointerMove(event: PointerEvent) {
      if (!dragging) return;
      const dx = event.clientX - startX, dy = event.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      yaw -= dx * 0.009;
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.009, -1.42, 1.42);
      startX = event.clientX; startY = event.clientY;
    }
    function pointerUp(event: PointerEvent) {
      dragging = false;
      if (host!.hasPointerCapture(event.pointerId)) host!.releasePointerCapture(event.pointerId);
      if (moved || !gltfRoot || !activeRef.current) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(2 * (event.clientX - bounds.left) / bounds.width - 1,
        1 - 2 * (event.clientY - bounds.top) / bounds.height);
      ray.setFromCamera(ndc, camera);
      // Selecting a colored marker is separate from moving it. Only clicking
      // the hull relocates whichever marker is visibly selected.
      const markerHits = ray.intersectObjects(Array.from(visibleMarkers.values()), false);
      if (markerHits.length) {
        const id = markerHits[0].object.userData.hardpointId as string;
        if (id) { setActiveId(id); setStatus("Selected " + (pointsRef.current.find(p => p.id === id)?.label ?? id) + ". Click hull to move it."); }
        return;
      }
      const hits = ray.intersectObject(oriented, true);
      if (hits.length) updatePointRef.current(sourcePosition(hits[0].point));
    }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.008, 2.0, 16);
    }
    host.addEventListener("pointerdown", pointerDown);
    host.addEventListener("pointermove", pointerMove);
    host.addEventListener("pointerup", pointerUp);
    host.addEventListener("pointercancel", pointerUp);
    host.addEventListener("wheel", wheel, { passive: false });

    function draw() {
      if (disposed) return;
      cameraPose();
      if (gltfRoot) {
        const current = new Set(pointsRef.current.map((point) => point.id));
        for (const [id, mesh] of visibleMarkers) {
          if (!current.has(id)) {
            markers.remove(mesh);
            (mesh.material as THREE.Material).dispose();
            visibleMarkers.delete(id);
          }
        }
        for (const point of pointsRef.current) {
          let marker = visibleMarkers.get(point.id);
          if (!marker) {
            marker = new THREE.Mesh(sharedMarkerGeometry, new THREE.MeshBasicMaterial({ color: 0x65b5ff }));
            markers.add(marker);
            visibleMarkers.set(point.id, marker);
          }
          marker.userData.hardpointId = point.id;
          (marker.material as THREE.MeshBasicMaterial).color.setHex(markerColor(point.id));
          marker.scale.setScalar(point.id === activeRef.current ? 2.1 : 1.35);
          marker.position.copy(gltfRoot.localToWorld(new THREE.Vector3(...point.position)));
        }
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      viewPresetRef.current = () => {};
      regenerateRef.current = () => {};
      host.removeEventListener("pointerdown", pointerDown);
      host.removeEventListener("pointermove", pointerMove);
      host.removeEventListener("pointerup", pointerUp);
      host.removeEventListener("pointercancel", pointerUp);
      host.removeEventListener("wheel", wheel);
      for (const mesh of visibleMarkers.values()) (mesh.material as THREE.Material).dispose();
      sharedMarkerGeometry.dispose();
      if (gltfRoot) gltfRoot.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
      renderer.dispose();
      host.replaceChildren();
    };
  }, [projectPath, folder, selectedModel?.modelPath, selectedModel?.transform.yawDegrees,
      selectedModel?.transform.pitchDegrees, selectedModel?.transform.rollDegrees,
      selectedModel?.transform.scale]);

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      const output = await invoke<string>("save_model_hardpoints", {
        request: { projectPath, modelFolder: folder, modelPath: selected, orientation: selectedModel!.transform, hardpoints: points }
      });
      setStoredReview(null);
      setRepoStatus(null);
      setPushApproved(false);
      setRemoteOutOfDate(false);
      setMergeApproved(false);
      setRepoMessage("Saved locally, not committed or pushed. Review linked repository when all ships are saved.");
      setStatus("Explicitly saved this review to: " + output);
    } catch (error) { setStatus("ERROR: Save failed: " + String(error)); }
    finally { setBusy(false); }
  }

  async function reviewRepo() {
    setBusy(true);
    setRepoMessage("");
    setPushApproved(false);
    try {
      const data = await invoke<RepoStatus>("review_hardpoint_repo", {
        request: { projectPath }
      });
      setRepoStatus(data);
      setRemoteOutOfDate(/behind [0-9]+/.test(data.branchStatus));
      setRepoMessage("Review complete. Commit saves only changed hardpoint data. Remote integration and Push require separate approval.");
    } catch (error) {
      setRepoStatus(null);
      setRepoMessage("ERROR: " + String(error));
    } finally { setBusy(false); }
  }

  async function commitRepo() {
    setBusy(true);
    setRepoMessage("");
    try {
      const result = await invoke<GitActionResult>("commit_hardpoint_repo", {
        request: { projectPath }
      });
      setPushApproved(false);
      setRemoteOutOfDate(false);
      setMergeApproved(false);
      const data = await invoke<RepoStatus>("review_hardpoint_repo", {
        request: { projectPath }
      });
      setRepoStatus(data);
      setRepoMessage("COMMITTED locally (not yet pushed): " + result.output);
    } catch (error) {
      setRepoMessage("ERROR: Commit not confirmed: " + String(error));
    } finally { setBusy(false); }
  }

  async function pushRepo() {
    if (!pushApproved || !repoStatus) return;
    setBusy(true);
    setRepoMessage("");
    try {
      // Uses Asset Forge's existing linked-project remote configuration.
      const result = await invoke<GitActionResult>("sync_external_project", {
        request: { path: projectPath, action: "push" }
      });
      setPushApproved(false);
      setRemoteOutOfDate(false);
      setMergeApproved(false);
      setRepoMessage("PUSH COMPLETED: " + result.output);
    } catch (error) {
      const detail = String(error);
      setRemoteOutOfDate(/fetch first|non-fast-forward|rejected.*main/i.test(detail));
      setMergeApproved(false);
      setPushApproved(false);
      setRepoMessage("ERROR: Git push did not succeed: " + detail);
    } finally { setBusy(false); }
  }

  async function integrateRemote() {
    if (!mergeApproved || !repoStatus) return;
    setBusy(true);
    setRepoMessage("");
    try {
      const result = await invoke<GitActionResult>("integrate_hardpoint_remote", {
        request: { projectPath }
      });
      const data = await invoke<RepoStatus>("review_hardpoint_repo", {
        request: { projectPath }
      });
      setRepoStatus(data);
      setRemoteOutOfDate(false);
      setMergeApproved(false);
      setPushApproved(false);
      setRepoMessage("REMOTE INTEGRATED: " + result.output + " Review the repository, then approve Push separately.");
    } catch (error) {
      setMergeApproved(false);
      setRepoMessage("ERROR: Remote integration did not complete: " + String(error));
    } finally { setBusy(false); }
  }

  function onFolderChange(value: string) {
    setFolder(value);
    setModelFolderPreference(projectPath, value);
    setModels([]);
    setSelected("");
    setPoints([]);
    setReady(false);
    setStoredReview(null);
  }

  return <div className="orientation-tool">
    <div className="section-heading"><h3>Model Hardpoints</h3><span>Source-local coordinates, preview in canonical orientation</span></div>
    <p className="tool-note">
      This tool uses the model's saved orientation, not raw GLB axes. Expected forward: -Z;
      port: -X; starboard: +X. Candidate names are geometry hints, not recognized ship parts.
      Approve only after viewing the bow and stern.
    </p>
    <div className="image-config-grid">
      <label>Model folder <input value={folder} onChange={(e) => onFolderChange(e.target.value)} /></label>
      <label>Model <select value={selected} onChange={(e) => { setSelected(e.target.value); setPoints([]); setStoredReview(null); setRepoStatus(null); setPushApproved(false); setReady(false); }}>
        {models.map((model) => <option key={model.modelPath} value={model.modelPath}>{model.fileName}</option>)}
      </select></label>
    </div>
    <div className="button-row">
      <button type="button" disabled={busy} onClick={() => void load()}>Load Models / Refresh Orientation</button>
      <button type="button" disabled={!ready || busy} onClick={() => regenerateRef.current()}>Regenerate Current Proposals</button>
    </div>
    {selectedModel ? <p className="tool-note">
      Saved orientation: yaw {selectedModel.transform.yawDegrees}°, pitch {selectedModel.transform.pitchDegrees}°,
      roll {selectedModel.transform.rollDegrees}°. If wrong, correct it in Model Orientation, save, then refresh here.
    </p> : null}
    {storedReview ? <div className="tool-note" role="status">
      A stored record was found in {storedReview.manifestPath}.
      {storedReview.updatedAt ? " Its timestamp is " + storedReview.updatedAt + "." : ""}
      {sameOrientation(storedReview.savedOrientation, selectedModel!.transform)
        ? " Its recorded orientation matches this model."
        : " Its orientation is missing or differs, so restoring it is disabled."}
      <div className="button-row">
        <button type="button" disabled={!ready || busy || !sameOrientation(storedReview.savedOrientation, selectedModel!.transform)}
          onClick={() => {
            setPoints(storedReview.points.map((point) => ({ ...point })));
            setStoredReview(null);
            setStatus("Existing review restored at your request. Verify every point before saving.");
          }}>Restore Previous Review</button>
        <button type="button" onClick={() => {
          setStoredReview(null);
          setStatus("Keeping fresh unsaved proposals; existing file untouched.");
        }}>Use Fresh Proposals</button>
      </div>
    </div> : null}
    <div className="button-row" aria-label="Camera views">
      {(["stern", "bow", "port", "starboard", "top"] as ViewPreset[]).map((view) =>
        <button key={view} type="button" disabled={!ready} onClick={() => viewPresetRef.current(view)}>
          View {view}
        </button>)}
    </div>
    <div ref={viewRef} className="model-preview" style={{ height: 480 }}>
      {!("__TAURI_INTERNALS__" in window) ? "Native desktop preview required." : null}
    </div>
    <p className="preview-help">
      Drag to orbit; wheel to zoom. Click the mesh to relocate the selected candidate.
      Gold arrow: bow (-Z); red: port (-X); green: starboard (+X).
      Cyan: engine; red: port; green: starboard; gold: bow. Selected marker is larger.
      Click a marker to select it, then click hull to reposition. Approval is separate from selection.
    </p>
    <p className="tool-note" role="status" style={{fontWeight:700}}>
      {points.length ? "Moving: " + (points.find(p => p.id === activeId)?.label ?? "Select a marker") +
        " (large marker). Select another colored marker or its row before moving." : "No hardpoints loaded."}
      {" "}Approval stays in memory until you click Save Reviewed Hardpoints.
    </p>
    <table><thead><tr><th>Approve</th><th>Candidate</th><th>Type</th><th>Source-local XYZ</th></tr></thead><tbody>
      {points.map((point) => <tr key={point.id} style={{ background: point.id === activeId ? "rgba(120,160,190,.15)" : undefined }}>
        <td><input aria-label={`Approve ${point.label}`} type="checkbox" checked={point.approved} onChange={(e) => {
          const checked = e.target.checked;
          setPoints((items) => items.map((item) => item.id === point.id ? { ...item, approved: checked } : item));
          setRepoStatus(null);
          setPushApproved(false);
          setStatus("Approval changed in editor only; use Save Reviewed Hardpoints to persist.");
        }} /></td>
        <td><button type="button" onClick={() => setActiveId(point.id)} aria-pressed={activeId === point.id}>
          <span aria-hidden="true" style={{display:"inline-block",width:12,height:12,borderRadius:"50%",background:markerCss(point.id),marginRight:8}} />
          {activeId === point.id ? "Selected: " : "Select: "}{point.label}
        </button></td>
        <td><select value={point.kind} onChange={(e) => setPoints((items) => items.map((item) =>
          item.id === point.id ? { ...item, kind: e.target.value as Kind, approved: false } : item))}>
          {types.map((type) => <option key={type} value={type}>{type}</option>)}
        </select></td>
        <td>{point.position.map((value) => value.toFixed(3)).join(", ")}</td>
      </tr>)}
    </tbody></table>
    <div className="button-row"><button type="button" className="primary" disabled={busy || !ready || !selected || !points.length} onClick={() => void save()}>
      Save Reviewed Hardpoints
    </button></div>
    <section className="detail-card" aria-label="Publish reviewed hardpoints to linked repository">
      <h4>Linked repository publication</h4>
      <p className="tool-note">
        Save all ships locally first. Review covers the complete shared manifest, not just the selected ship.
        Commit records only that manifest; pushing may publish other unpushed branch commits as well.
      </p>
      <div className="button-row">
        <button type="button" disabled={busy} onClick={() => void reviewRepo()}>Review Git Status</button>
        <button type="button" disabled={busy || !repoStatus || repoStatus.approvedModelCount === 0}
          onClick={() => void commitRepo()}>Commit Hardpoint Manifest</button>
      </div>
      {repoStatus ? <div className="tool-note">
        <p><strong>Linked repository:</strong> {repoStatus.repository}</p>
        <p><strong>Stored models:</strong> {repoStatus.modelCount} / <strong>With approvals:</strong> {repoStatus.approvedModelCount}</p>
        <p><strong>Manifest:</strong> {repoStatus.manifestPath}</p>
        <pre>{repoStatus.branchStatus}</pre>
        <pre>{repoStatus.changeStatus}</pre>
      </div> : null}
      {repoStatus ? <div className="tool-note" role="status">
        <p><strong>Integrate Remote Main</strong>{remoteOutOfDate ? ": Remote main has newer commits. Integrate before retrying Push." : ": Check and incorporate any newer remote commits before Push. Existing local commits are preserved."}</p>
        <label><input type="checkbox" checked={mergeApproved} onChange={(e) => setMergeApproved(e.target.checked)} />
          I approve merging remote main into this local main checkout. No force push or reset will be used.
        </label>
        <div className="button-row">
          <button type="button" disabled={busy || !mergeApproved} onClick={() => void integrateRemote()}>
            Integrate Remote Main
          </button>
        </div>
      </div> : null}
      {repoStatus ? <>
        <label><input type="checkbox" checked={pushApproved} onChange={(e) => setPushApproved(e.target.checked)} />
          I have reviewed the repository and understand Push sends the current branch's unpushed commits.
        </label>
        <div className="button-row">
          <button type="button" disabled={busy || !pushApproved || remoteOutOfDate} onClick={() => void pushRepo()}>
            Push to Linked Repository
          </button>
        </div>
      </> : null}
      {repoMessage ? <p role="status" className="tool-note">{repoMessage}</p> : null}
    </section>
    <p className="tool-note" role="status">{status}</p>
  </div>;
}
