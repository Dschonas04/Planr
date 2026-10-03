import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildHouseGroup, disposeGroup, houseBounds } from '../three/scene.js';
import { setState, useStore } from '../store.js';

export default function View3D() {
  const mountRef = useRef(null);
  const ctxRef = useRef(null);
  const state = useStore();
  const project = state.project;
  const only = state.settings.only3dLevel ? Math.min(state.activeLevel, project.levels.length - 1) : null;
  const showRoof = state.settings.showRoof;

  // Renderer, Kamera und Licht leben ueber die gesamte Lebensdauer der
  // Ansicht -- nur die Geometrie wird bei Planaenderungen ausgetauscht.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe6ea);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800);
    camera.position.set(10, 10, 12);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05; // nicht unter den Boden schauen

    // Innenraeume liegen weitgehend im Schlagschatten der Waende -- deshalb
    // viel Umgebungslicht und eine eher zurueckhaltende Sonne.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9c9384, 1.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(12, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    scene.add(sun);

    // Gelände 30 cm unter dem Erdgeschossfußboden.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshLambertMaterial({ color: 0xb9c3ab }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;
    ground.receiveShadow = true;
    scene.add(ground);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    animate();

    ctxRef.current = { scene, camera, controls, renderer, group: null, framed: false, ground };

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      if (ctxRef.current?.group) disposeGroup(ctxRef.current.group);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.group) {
      ctx.scene.remove(ctx.group);
      disposeGroup(ctx.group);
    }
    ctx.group = buildHouseGroup(project, { only, showRoof });
    ctx.scene.add(ctx.group);
    // Ein Keller allein liegt unter dem Gelände -- dann das Gelände ausblenden.
    ctx.ground.visible = only == null || project.levels[only].elevationCm >= -1;

    // Kamera nur beim ersten Aufbau ausrichten, sonst springt die Ansicht
    // bei jeder Aenderung zurueck.
    if (!ctx.framed) {
      const { center, radius } = houseBounds(project);
      ctx.controls.target.copy(center);
      ctx.camera.position.set(center.x + radius * 1.5, center.y + radius * 1.1, center.z + radius * 1.7);
      ctx.camera.updateProjectionMatrix();
      ctx.framed = true;
    }
  }, [project, only, showRoof]);

  const toggle = (key) => (e) => setState({ settings: { ...state.settings, [key]: e.target.checked } });
  return (
    <div className="view3d" ref={mountRef}>
      <div className="view3d-optionen">
        <label className="toggle">
          <input type="checkbox" checked={state.settings.only3dLevel} onChange={toggle('only3dLevel')} />
          Nur aktuelles Geschoss
        </label>
        <label className="toggle">
          <input type="checkbox" checked={state.settings.showRoof} onChange={toggle('showRoof')} disabled={state.settings.only3dLevel} />
          Dach
        </label>
      </div>
    </div>
  );
}
