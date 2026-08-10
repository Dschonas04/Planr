// Interaktion auf dem Grundriss-Canvas. Haelt den fluechtigen Drag-Zustand
// lokal und schreibt nur abgeschlossene Aenderungen in den Store.

import { angleOf, dist, rotate, snapAngle, sub } from '../model/geometry.js';
import { screenToWorld, snap } from '../model/units.js';
import {
  DEFAULTS,
  nearestWall,
  newId,
  offsetAlongWall,
  wallLength,
} from '../model/project.js';
import { catalogItem } from '../model/catalog.js';
import { hitTest, snapPoint } from './hitTest.js';
import { activeLevel, commit, getState, setState, toast } from '../store.js';

const ANGLE_STEP = Math.PI / 12; // 15 Grad

export function createInteraction(canvas) {
  let drag = null;
  let spaceDown = false;

  const pointerWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const s = getState();
    return screenToWorld({ x: ev.clientX - rect.left, y: ev.clientY - rect.top }, s.view);
  };

  // --- Werkzeug: Wand zeichnen ---------------------------------------

  function wallDraftPoint(p, ev) {
    const s = getState();
    const level = activeLevel(s);
    const { point, snapped } = snapPoint(level, p, s.settings, s.view);
    const draft = s.draft;
    if (draft?.points.length && s.settings.angleSnap && !ev.altKey && !snapped) {
      const last = draft.points[draft.points.length - 1];
      return { point: snapAngle(last, point, ANGLE_STEP), snapped: null };
    }
    return { point, snapped };
  }

  function commitDraft() {
    const s = getState();
    const pts = s.draft?.points || [];
    if (pts.length < 2) {
      setState({ draft: null });
      return;
    }
    const thickness = s.settings.wallThicknessCm;
    commit((project) => {
      const level = project.levels[s.activeLevel];
      for (let i = 0; i < pts.length - 1; i++) {
        if (dist(pts[i], pts[i + 1]) < 1) continue;
        level.walls.push({
          id: newId('w'),
          a: { ...pts[i] },
          b: { ...pts[i + 1] },
          thicknessCm: thickness,
          heightCm: level.heightCm,
        });
      }
    });
    setState({ draft: null });
  }

  // --- Werkzeug: Oeffnung setzen -------------------------------------

  function placeOpening(p, type) {
    const s = getState();
    const level = activeLevel(s);
    const hit = nearestWall(level, p, 60);
    if (!hit) {
      toast('Tür und Fenster brauchen eine Wand — bitte näher an eine Wand klicken.', 'warn');
      return;
    }
    const isWindow = type === 'window';
    const width = isWindow ? DEFAULTS.windowWidthCm : DEFAULTS.doorWidthCm;
    const total = wallLength(hit.wall);
    // Vollstaendig in die Wand schieben, sonst haengt die Oeffnung ueber.
    const offset = Math.max(width / 2, Math.min(total - width / 2, hit.offsetCm));
    if (total < width + 10) {
      toast('Die Wand ist für diese Öffnung zu kurz.', 'warn');
      return;
    }
    const id = newId('op');
    commit((project) => {
      project.levels[s.activeLevel].openings.push({
        id,
        wallId: hit.wall.id,
        offsetCm: offset,
        widthCm: width,
        heightCm: isWindow ? DEFAULTS.windowHeightCm : DEFAULTS.doorHeightCm,
        sillCm: isWindow ? DEFAULTS.windowSillCm : 0,
        type: isWindow ? 'window' : 'door',
        swing: 1,
      });
    });
    setState({ selection: { kind: 'opening', id }, tool: 'select' });
  }

  // --- Werkzeug: Moebel platzieren -----------------------------------

  function placeFurniture(p) {
    const s = getState();
    const item = catalogItem(s.pendingCatalogId);
    if (!item) return;
    const step = s.settings.snapEnabled ? s.settings.gridCm : 0;
    const id = newId('f');
    commit((project) => {
      project.levels[s.activeLevel].furniture.push({
        id,
        catalogId: item.id,
        label: item.label,
        x: snap(p.x, step),
        y: snap(p.y, step),
        widthCm: item.w,
        depthCm: item.d,
        heightCm: item.h,
        rotationDeg: 0,
        color: item.color,
      });
    });
    setState({ selection: { kind: 'furniture', id } });
  }

  // --- Zeiger-Events --------------------------------------------------

  function onPointerDown(ev) {
    if (ev.button === 2) return; // Rechtsklick beendet nur den Entwurf
    canvas.setPointerCapture?.(ev.pointerId);
    const s = getState();
    const p = pointerWorld(ev);
    const level = activeLevel(s);

    const wantsPan = s.tool === 'pan' || spaceDown || ev.button === 1;
    if (wantsPan) {
      drag = { mode: 'pan', startX: ev.clientX, startY: ev.clientY, panX: s.view.panX, panY: s.view.panY };
      return;
    }

    if (s.tool === 'wall') {
      const { point } = wallDraftPoint(p, ev);
      const pts = s.draft ? [...s.draft.points, point] : [point];
      setState({ draft: { points: pts, preview: point } });
      return;
    }

    if (s.tool === 'door' || s.tool === 'window') {
      placeOpening(p, s.tool);
      return;
    }

    if (s.tool === 'place') {
      placeFurniture(p);
      return;
    }

    // Auswahlwerkzeug
    const hit = hitTest(level, p, s.view, s.selection);
    if (!hit) {
      setState({ selection: null });
      drag = { mode: 'pan', startX: ev.clientX, startY: ev.clientY, panX: s.view.panX, panY: s.view.panY };
      return;
    }

    setState({ selection: { kind: hit.kind, id: hit.id } });

    if (hit.kind === 'furniture') {
      const f = level.furniture.find((x) => x.id === hit.id);
      drag = {
        mode: hit.part === 'body' ? 'move-furniture' : hit.part === 'rotate' ? 'rotate-furniture' : 'resize-furniture',
        id: hit.id,
        corner: hit.corner,
        grabOffset: { x: p.x - f.x, y: p.y - f.y },
        start: { ...f },
        moved: false,
      };
    } else if (hit.kind === 'wall') {
      const w = level.walls.find((x) => x.id === hit.id);
      drag = {
        mode: hit.part === 'body' ? 'move-wall' : 'move-wall-end',
        id: hit.id,
        end: hit.part,
        startPoint: p,
        start: { a: { ...w.a }, b: { ...w.b } },
        moved: false,
      };
    } else if (hit.kind === 'opening') {
      drag = { mode: 'move-opening', id: hit.id, moved: false };
    }
  }

  function onPointerMove(ev) {
    const s = getState();
    const p = pointerWorld(ev);

    if (!drag) {
      if (s.tool === 'wall' && s.draft) {
        const { point, snapped } = wallDraftPoint(p, ev);
        setState({ draft: { ...s.draft, preview: point }, snapPoint: snapped });
      } else if (s.tool === 'wall') {
        const { snapped } = wallDraftPoint(p, ev);
        setState({ snapPoint: snapped });
      }
      return;
    }

    if (drag.mode === 'pan') {
      setState({
        view: {
          ...s.view,
          panX: drag.panX + (ev.clientX - drag.startX),
          panY: drag.panY + (ev.clientY - drag.startY),
        },
      });
      return;
    }

    const step = s.settings.snapEnabled ? s.settings.gridCm : 0;
    const merge = drag.moved;
    drag.moved = true;

    if (drag.mode === 'move-furniture') {
      commit((project) => {
        const f = project.levels[s.activeLevel].furniture.find((x) => x.id === drag.id);
        if (!f) return false;
        f.x = snap(p.x - drag.grabOffset.x, step);
        f.y = snap(p.y - drag.grabOffset.y, step);
      }, { merge });
      return;
    }

    if (drag.mode === 'rotate-furniture') {
      commit((project) => {
        const f = project.levels[s.activeLevel].furniture.find((x) => x.id === drag.id);
        if (!f) return false;
        // Der Griff sitzt "oben", daher plus 90 Grad gegenueber dem Zeigerwinkel.
        let deg = (angleOf(sub(p, { x: f.x, y: f.y })) * 180) / Math.PI + 90;
        if (!ev.altKey) deg = Math.round(deg / 15) * 15;
        f.rotationDeg = ((deg % 360) + 360) % 360;
      }, { merge });
      return;
    }

    if (drag.mode === 'resize-furniture') {
      commit((project) => {
        const f = project.levels[s.activeLevel].furniture.find((x) => x.id === drag.id);
        if (!f) return false;
        // Im lokalen System des Objekts rechnen, damit Rotation nicht stoert.
        const rad = (f.rotationDeg * Math.PI) / 180;
        const local = rotate(p, -rad, { x: drag.start.x, y: drag.start.y });
        const w = Math.abs(local.x - drag.start.x) * 2;
        const d = Math.abs(local.y - drag.start.y) * 2;
        f.widthCm = Math.max(10, snap(w, step || 1));
        f.depthCm = Math.max(10, snap(d, step || 1));
      }, { merge });
      return;
    }

    if (drag.mode === 'move-wall') {
      const delta = sub(p, drag.startPoint);
      commit((project) => {
        const w = project.levels[s.activeLevel].walls.find((x) => x.id === drag.id);
        if (!w) return false;
        w.a = { x: snap(drag.start.a.x + delta.x, step), y: snap(drag.start.a.y + delta.y, step) };
        w.b = { x: snap(drag.start.b.x + delta.x, step), y: snap(drag.start.b.y + delta.y, step) };
      }, { merge });
      return;
    }

    if (drag.mode === 'move-wall-end') {
      const level = activeLevel(s);
      const { point, snapped } = snapPoint(level, p, s.settings, s.view, [drag.id]);
      setState({ snapPoint: snapped });
      commit((project) => {
        const w = project.levels[s.activeLevel].walls.find((x) => x.id === drag.id);
        if (!w) return false;
        w[drag.end] = { x: point.x, y: point.y };
      }, { merge });
      return;
    }

    if (drag.mode === 'move-opening') {
      commit((project) => {
        const level = project.levels[s.activeLevel];
        const op = level.openings.find((x) => x.id === drag.id);
        if (!op) return false;
        const wall = level.walls.find((w) => w.id === op.wallId);
        if (!wall) return false;
        const total = wallLength(wall);
        const raw = offsetAlongWall(wall, p);
        op.offsetCm = Math.max(op.widthCm / 2, Math.min(total - op.widthCm / 2, raw));
      }, { merge });
    }
  }

  function onPointerUp(ev) {
    canvas.releasePointerCapture?.(ev.pointerId);
    drag = null;
    setState({ snapPoint: null });
  }

  function onWheel(ev) {
    ev.preventDefault();
    const s = getState();
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const zoom = Math.min(6, Math.max(0.05, s.view.zoom * factor));
    // Auf den Mauszeiger zoomen: der Weltpunkt unter dem Zeiger bleibt fix.
    setState({
      view: {
        zoom,
        panX: mx - ((mx - s.view.panX) / s.view.zoom) * zoom,
        panY: my - ((my - s.view.panY) / s.view.zoom) * zoom,
      },
    });
  }

  function onDoubleClick() {
    if (getState().tool === 'wall') commitDraft();
  }

  function onContextMenu(ev) {
    ev.preventDefault();
    const s = getState();
    if (s.tool === 'wall' && s.draft) commitDraft();
  }

  function onKeyDown(ev) {
    if (ev.code === 'Space') spaceDown = true;
  }

  function onKeyUp(ev) {
    if (ev.code === 'Space') spaceDown = false;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    finishDraft: commitDraft,
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
