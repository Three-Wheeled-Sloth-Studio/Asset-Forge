import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

type Model = { modelPath: string; fileName: string };
type Catalog = { models: Model[] };
type Kind = "enginePort" | "maneuverThruster" | "navigationLight" | "weaponMountHint" | "cameraInspectAnchor" | "selectionAnchor" | "articulationCandidate";
type Point = { id: string; kind: Kind; label: string; position: [number, number, number]; approved: boolean; method: string };
const types: Kind[] = ["enginePort", "navigationLight", "maneuverThruster", "weaponMountHint", "cameraInspectAnchor", "selectionAnchor", "articulationCandidate"];
const proposals: Array<[string, Kind, string, THREE.Vector3]> = [
  ["engine-port", "enginePort", "Aft engine candidate", new THREE.Vector3(0, 0, 1)],
  ["port-light", "navigationLight", "Port edge candidate", new THREE.Vector3(-1, 0, 0)],
  ["starboard-light", "navigationLight", "Starboard edge candidate", new THREE.Vector3(1, 0, 0)],
  ["inspection", "cameraInspectAnchor", "Forward inspection candidate", new THREE.Vector3(0, 0, -1)]
];

export function HardpointAnalyzer({ projectPath }: { projectPath: string }) {
  const [folder, setFolder] = useState("assets\\models\\ships");
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState("");
  const [points, setPoints] = useState<Point[]>([]);
  const [activeId, setActiveId] = useState("engine-port");
  const [status, setStatus] = useState("Select a linked model folder and load models.");
  const [busy, setBusy] = useState(false);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const pointsRef = useRef(points);
  const activeRef = useRef(activeId);
  const updatePointRef = useRef<(value: [number,number,number]) => void>(() => {});
  pointsRef.current = points;
  activeRef.current = activeId;
  updatePointRef.current = (position) => setPoints((items) => items.map((point) =>
    point.id === activeRef.current ? { ...point, position, approved: false, method: "surface-click" } : point));

  async function load() {
    setBusy(true);
    try {
      const result = await invoke<Catalog>("list_ship_model_orientations", {
        request: { projectPath, modelFolder: folder, manifestPath: "refs\\assetForge\\ship-model-orientation.manifest.json" }
      });
      setModels(result.models);
      setSelected(result.models[0]?.modelPath ?? "");
      setStatus(result.models.length ? "Select a model. Candidates are unapproved until checked." : "No GLB models found.");
    } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const host = viewRef.current;
    if (!host || !selected || !("__TAURI_INTERNALS__" in window)) return;
    const width = Math.max(320, host.clientWidth);
    const height = 450;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x131a20);
    const camera = new THREE.PerspectiveCamera(43, width / height, 0.01, 500);
    camera.position.set(4.1, 3.0, 5.0);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.replaceChildren(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 1.65));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const group = new THREE.Group();
    scene.add(group);
    const markers = new THREE.Group();
    scene.add(markers);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    let gltfRoot: THREE.Object3D | null = null;
    let disposed = false;
    let center = new THREE.Vector3();
    let size = new THREE.Vector3(1,1,1);
    let normalizer = 1;
    const ray = new THREE.Raycaster();
    let dragging = false, moved = false, startX = 0, startY = 0;
    const visibleMarkers = new Map<string, THREE.Mesh>();
    const sharedMarkerGeometry = new THREE.SphereGeometry(0.024, 10, 8);
    let yaw = 0.7, pitch = 0.35, distance = 6.4;
    function cameraPose() {
      camera.position.set(distance * Math.sin(yaw) * Math.cos(pitch), distance * Math.sin(pitch), distance * Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(0,0,0);
    }
    function vertexFromWorld(point: THREE.Vector3): [number,number,number] {
      // Manifest coordinates use the unmodified source GLB's local frame, not preview normalization.
      const local = gltfRoot!.worldToLocal(point.clone());
      return [local.x, local.y, local.z];
    }
    function markerPosition(point: Point) {
      return gltfRoot!.localToWorld(new THREE.Vector3(...point.position));
    }
    function suggest(root: THREE.Object3D) {
      root.updateMatrixWorld(true);
      const options: Point[] = [];
      for (const [id, kind, label, dir] of proposals) {
        const origin = center.clone().addScaledVector(dir, Math.max(size.x, size.y, size.z) * 3);
        const direction = dir.clone().negate();
        ray.set(origin, direction);
        const hits = ray.intersectObject(root, true);
        if (!hits.length) continue;
        options.push({ id, kind, label, position: vertexFromWorld(hits[0].point), approved: false, method: "bounding-axis-raycast" });
      }
      void invoke<Point[]>("load_model_hardpoints", {
        request: { projectPath, modelFolder: folder, modelPath: selected }
      }).then((saved) => {
        if (disposed) return;
        if (saved.length) {
          setPoints(saved);
          setStatus(`Loaded ${saved.length} previously reviewed points. Existing approvals preserved.`);
        } else {
          setPoints(options);
          setStatus(options.length ? `Proposed ${options.length} surface points. Labels are guesses. Review each on the model.` : "No surface intersections found. Check orientation and model geometry.");
        }
      }).catch((error) => setStatus("Cannot read prior review; refusing to overwrite: " + String(error)));
    }
    void invoke<number[]>("load_ship_model_preview", {
      request: { projectPath, modelFolder: folder, modelPath: selected }
    }).then((bytes) => {
      if (disposed) return;
      loader.parse(new Uint8Array(bytes).buffer, "", ({scene: root}) => {
        if (disposed) return;
        gltfRoot = root;
        group.add(root);
        const bounds = new THREE.Box3().setFromObject(root);
        bounds.getCenter(center);
        bounds.getSize(size);
        normalizer = 3.1 / Math.max(0.001, size.x, size.y, size.z);
        root.position.sub(center.clone().multiplyScalar(normalizer));
        root.scale.setScalar(normalizer);
        root.updateMatrixWorld(true);
        // The generated world-space candidate rays target normalized preview geometry.
        const raw = new THREE.Box3().setFromObject(root);
        raw.getCenter(center);
        raw.getSize(size);
        suggest(root);
      }, (error) => setStatus("GLB parse error: " + String(error)));
    }).catch((error) => setStatus("GLB load error: " + String(error)));
    function pointerDown(event: PointerEvent) { dragging = true; moved = false; startX = event.clientX; startY = event.clientY; host!.setPointerCapture(event.pointerId); }
    function pointerMove(event: PointerEvent) {
      if (!dragging) return;
      const dx = event.clientX - startX, dy = event.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      yaw -= dx * 0.009;
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.009, -1.25, 1.25);
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
      const hits = ray.intersectObject(gltfRoot, true);
      if (hits.length) updatePointRef.current(vertexFromWorld(hits[0].point));
    }
    function wheel(event: WheelEvent) { event.preventDefault(); distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.008, 2.1, 16); }
    host.addEventListener("pointerdown", pointerDown);
    host.addEventListener("pointermove", pointerMove);
    host.addEventListener("pointerup", pointerUp);
    host.addEventListener("pointercancel", pointerUp);
    host.addEventListener("wheel", wheel, { passive:false });
    let frame = 0;
    function draw() {
      if (disposed) return;
      cameraPose();
      if (gltfRoot) {
        const current = new Set(pointsRef.current.map(p => p.id));
        for (const [id, mesh] of visibleMarkers) {
          if (!current.has(id)) {
            markers.remove(mesh);
            (mesh.material as THREE.Material).dispose();
            visibleMarkers.delete(id);
          }
        }
        for (const point of pointsRef.current) {
          let spot = visibleMarkers.get(point.id);
          if (!spot) {
            spot = new THREE.Mesh(sharedMarkerGeometry, new THREE.MeshBasicMaterial({color:0x65b5ff}));
            markers.add(spot);
            visibleMarkers.set(point.id, spot);
          }
          (spot.material as THREE.MeshBasicMaterial).color.setHex(point.approved ? 0x50cf88 : point.id === activeRef.current ? 0xffd977 : 0x65b5ff);
          spot.position.copy(markerPosition(point));
        }
      }
      renderer.render(scene,camera);
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      host.removeEventListener("pointerdown", pointerDown);
      host.removeEventListener("pointermove", pointerMove);
      host.removeEventListener("pointerup", pointerUp);
      host.removeEventListener("pointercancel", pointerUp);
      host.removeEventListener("wheel", wheel);
      renderer.dispose();
      host.replaceChildren();
    };
  }, [projectPath, folder, selected]);

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      const output = await invoke<string>("save_model_hardpoints", {
        request: { projectPath, modelFolder: folder, modelPath: selected, hardpoints: points }
      });
      setStatus("Saved review manifest: " + output);
    } catch (error) { setStatus("Save failed: " + String(error)); }
    finally { setBusy(false); }
  }
  return <div className="orientation-tool">
    <div className="section-heading"><h3>Model Hardpoints</h3><span>Review before promotion</span></div>
    <p className="tool-note">Geometry-only proposals, not identified engines or hinges. Select a candidate, click the model to reposition, and approve individual points. Saved coordinates are source-GLB local; no source meshes are altered.</p>
    <div className="image-config-grid">
      <label>Model folder <input value={folder} onChange={(e) => setFolder(e.target.value)} /></label>
      <label>Model <select value={selected} onChange={(e) => {setSelected(e.target.value);setPoints([]);}}>
        {models.map((m) => <option key={m.modelPath} value={m.modelPath}>{m.fileName}</option>)}
      </select></label>
    </div>
    <div className="button-row"><button disabled={busy} onClick={() => void load()}>Load Models</button></div>
    <div ref={viewRef} className="model-preview" style={{height:450}}>{!("__TAURI_INTERNALS__" in window) ? "Native desktop preview required." : null}</div>
    <p className="preview-help">Drag to orbit, wheel to zoom. Select a point below, then click its desired surface location. Blue: proposal, yellow: selected, green: approved.</p>
    <table><thead><tr><th>Use</th><th>Candidate</th><th>Type</th><th>Local XYZ</th></tr></thead><tbody>
      {points.map((p) => <tr key={p.id} style={{background:p.id === activeId ? "rgba(120,160,190,.15)" : undefined}}>
        <td><input aria-label={`Approve ${p.label}`} type="checkbox" checked={p.approved} onChange={(e) => setPoints(xs => xs.map(x => x.id === p.id ? {...x,approved:e.target.checked}:x))} /></td>
        <td><button type="button" onClick={() => setActiveId(p.id)}>{p.label}</button></td>
        <td><select value={p.kind} onChange={(e) => setPoints(xs => xs.map(x => x.id === p.id ? {...x, kind:e.target.value as Kind, approved:false}:x))}>{types.map(t => <option key={t} value={t}>{t}</option>)}</select></td>
        <td>{p.position.map(v=>v.toFixed(3)).join(", ")}</td>
      </tr>)}
    </tbody></table>
    <div className="button-row"><button className="primary" disabled={busy || !selected || !points.length} onClick={() => void save()}>Save Reviewed Hardpoints</button></div>
    <p className="tool-note">{status}</p>
  </div>;
}
