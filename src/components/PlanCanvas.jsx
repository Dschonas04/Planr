import { useEffect, useRef } from 'react';
import { drawScene } from '../canvas2d/render.js';
import { deriveLevel } from '../canvas2d/derive.js';
import { createInteraction } from '../canvas2d/events.js';
import { worldToScreen } from '../model/units.ts';
import { activeLevel, einpassen, useStore } from '../store.js';

const CURSORS = {
  select: 'default',
  wall: 'crosshair',
  door: 'copy',
  window: 'copy',
  place: 'copy',
  stair: 'copy',
  dimension: 'crosshair',
  room: 'copy',
  pan: 'grab',
};

export default function PlanCanvas() {
  const canvasRef = useRef(null);
  const state = useStore();
  const level = activeLevel(state);
  const levelIndex = Math.min(state.activeLevel, state.project.levels.length - 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const interaction = createInteraction(canvas);
    return () => interaction.destroy();
  }, []);

  // Beim Öffnen eines Projekts den Plan einpassen, nicht bei jeder Änderung.
  const ladeZaehler = state.ladeZaehler || 0;
  useEffect(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) einpassen(rect.width, rect.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladeZaehler]);

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
        derived: deriveLevel(state.project, levelIndex),
        view: state.view,
        settings: state.settings,
        selection: state.selection,
        draft: state.draft,
        dimDraft: state.dimDraft,
        guides: state.guides,
        snapPoint: state.snapPoint,
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
  }, [state.project, level, levelIndex, state.view, state.settings, state.selection, state.draft, state.dimDraft, state.guides, state.snapPoint]);

  // Zahleneingabe beim Zeichnen: schwebt am letzten Punkt des Wandzugs.
  let eingabe = null;
  if (state.numInput && state.draft?.points.length) {
    const last = state.draft.points[state.draft.points.length - 1];
    const p = worldToScreen(last, state.view);
    eingabe = (
      <div className="zahleingabe" style={{ left: p.x + 14, top: p.y - 34 }}>
        <span>Länge{state.numInput.includes(';') ? ' ; Winkel' : ''}</span>
        <strong>{state.numInput}</strong>
        <em>cm · Enter</em>
      </div>
    );
  }

  return (
    <div className="plan-wrap">
      <canvas ref={canvasRef} className="plan-canvas" style={{ cursor: CURSORS[state.tool] || 'default' }} />
      {eingabe}
      <button
        type="button"
        className="einpassen"
        title="Ganzen Plan zeigen (0)"
        onClick={() => {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) einpassen(rect.width, rect.height);
        }}
      >
        Einpassen
      </button>
    </div>
  );
}
