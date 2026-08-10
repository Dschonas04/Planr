import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildLevelGroup, disposeGroup, levelBounds } from '../three/scene.js';
import { activeLevel, useStore } from '../store.js';

export default function View3D() {
  const mountRef = useRef(null);
  const ctxRef = useRef(null);
  const state = useStore();
  const level = activeLevel(state);

  // Renderer, Kamera und Licht leben ueber die gesamte Lebensdauer der
  // Ansicht -- nur die Geometrie wird bei Planaenderungen ausgetauscht.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe6ea);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
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
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9c9384, 1.35));
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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: 0xb9c3ab }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
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

    ctxRef.current = { scene, camera, controls, renderer, group: null, framed: false };

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
    ctx.group = buildLevelGroup(level);
    ctx.scene.add(ctx.group);

    // Kamera nur beim ersten Aufbau ausrichten, sonst springt die Ansicht
    // bei jeder Aenderung zurueck.
    if (!ctx.framed) {
      const { center, radius } = levelBounds(level);
      ctx.controls.target.copy(center);
      ctx.camera.position.set(center.x + radius, radius * 0.9, center.z + radius);
      ctx.camera.updateProjectionMatrix();
      ctx.framed = true;
    }
  }, [level]);

  return <div className="view3d" ref={mountRef} />;
}
