import { useEffect, useMemo, useRef } from 'react';
import { drawScene } from '../canvas2d/render.js';
import { createInteraction } from '../canvas2d/events.js';
import { findRooms } from '../model/geometry.js';
import { activeLevel, useStore } from '../store.js';

const CURSORS = {
  select: 'default',
  wall: 'crosshair',
  door: 'copy',
  window: 'copy',
  place: 'copy',
  pan: 'grab',
};

export default function PlanCanvas() {
  const canvasRef = useRef(null);
  const state = useStore();
  const level = activeLevel(state);

  // Raumerkennung ist der teuerste Schritt pro Frame -- nur neu rechnen,
  // wenn sich tatsaechlich Waende geaendert haben.
  const wallSignature = useMemo(
    () => level.walls.map((w) => `${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join('|'),
    [level.walls],
  );
  const rooms = useMemo(
    () => findRooms(level.walls.map((w) => ({ a: w.a, b: w.b }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallSignature],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const interaction = createInteraction(canvas);
    return () => interaction.destroy();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let frame = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      return { dpr, size: { width: rect.width, height: rect.height } };
    };

    const render = () => {
      const { dpr, size } = resize();
      drawScene(ctx, {
        level,
        view: state.view,
        settings: state.settings,
        selection: state.selection,
        draft: state.draft,
        snapPoint: state.snapPoint,
        rooms,
        canvasSize: size,
        dpr,
      });
      frame = 0;
    };

    frame = requestAnimationFrame(render);
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(render);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [level, rooms, state.view, state.settings, state.selection, state.draft, state.snapPoint]);

  return (
    <canvas
      ref={canvasRef}
      className="plan-canvas"
      style={{ cursor: CURSORS[state.tool] || 'default' }}
    />
  );
}
