// Interaktion auf dem Grundriss-Canvas. Haelt den fluechtigen Drag-Zustand
// lokal und schreibt nur abgeschlossene Aenderungen in den Store.

import { angleOf, dist, normal, normalize, pointInPolygon, rotate, snapAngle, sub } from '../model/geometry.ts';
import { screenToWorld, snap } from '../model/units.ts';
import {
  DEFAULTS,
  nearestWall,
  newId,
  offsetAlongWall,
  wallLength,
} from '../model/project.ts';
import { typeThickness, wallType } from '../model/wallTypes.ts';
import { wallCaps, wallOutline } from '../model/building.ts';
import { pointAlongWall } from '../model/project.ts';
import { catalogItem } from '../model/catalog.ts';
import { hitTest, snapPoint } from './hitTest.js';
import { parseNumInput } from './parseNumInput.js';

export { parseNumInput };
import { deriveLevel } from './derive.js';
import { activeLevel, commit, getState, setState, toast } from '../store.js';

const ANGLE_STEP = Math.PI / 12; // 15 Grad

/** Punkte, an denen Maße ansetzen: Wandecken und Leibungen auf den Wandflächen. */
function dimensionPoints(level) {
  const pts = [];
  const caps = wallCaps(level);
  for (const w of level.walls) {
    const cap = caps.get(w.id);
    if (cap) pts.push(...wallOutline(w, cap));
    const n = normal(normalize(sub(w.b, w.a)));
    for (const op of level.openings.filter((o) => o.wallId === w.id)) {
      for (const e of [op.offsetCm - op.widthCm / 2, op.offsetCm + op.widthCm / 2]) {
        const c = pointAlongWall(w, e);
        for (const s of [-1, 1]) pts.push({ x: c.x + (n.x * s * w.thicknessCm) / 2, y: c.y + (n.y * s * w.thicknessCm) / 2 });
      }
    }
  }
  return pts;
}

/**
 * Setzt den nächsten Punkt des Wandzugs aus der Zahleneingabe. Ohne Winkel
 * gilt die Richtung zum Mauszeiger; der Winkel zählt mathematisch positiv,
 * 0° = nach rechts, 90° = nach oben im Plan.
 */
export function applyNumInput() {
  const s = getState();
  const parsed = parseNumInput(s.numInput);
  const pts = s.draft?.points || [];
  if (!parsed || !pts.length) {
    setState({ numInput: '' });
    return;
  }
  const last = pts[pts.length - 1];
  let dir;
  if (parsed.angle != null) {
    const r = (parsed.angle * Math.PI) / 180;
    dir = { x: Math.cos(r), y: -Math.sin(r) };
  } else {
    const prev = s.draft.preview && dist(s.draft.preview, last) > 0.5 ? s.draft.preview : { x: last.x + 1, y: last.y };
    dir = normalize(sub(prev, last));
  }
  const next = { x: last.x + dir.x * parsed.length, y: last.y + dir.y * parsed.length };
  setState({ draft: { points: [...pts, next], preview: next }, numInput: '' });
}

export function createInteraction(canvas) {
  let drag = null;
  let spaceDown = false;

  const pointerWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const s = getState();
    return screenToWorld({ x: ev.clientX - rect.left, y: ev.clientY - rect.top }, s.view);
  };

  const levelIndex = () => {
    const s = getState();
    return Math.min(s.activeLevel, s.project.levels.length - 1);
  };

  // --- Werkzeug: Wand zeichnen ---------------------------------------

  function wallDraftPoint(p, ev) {
    const s = getState();
    const level = activeLevel(s);
    const { point, snapped, guides } = snapPoint(level, p, s.settings, s.view);
    const draft = s.draft;
    if (draft?.points.length && !snapped) {
      const last = draft.points[draft.points.length - 1];
      // Umschalt: nur waagerecht/senkrecht. Sonst 15°-Raster, Alt hebt es auf.
      if (ev.shiftKey) return { point: snapAngle(last, point, Math.PI / 2), snapped: null, guides: [] };
      if (s.settings.angleSnap && !ev.altKey && !guides.length) {
        return { point: snapAngle(last, point, ANGLE_STEP), snapped: null, guides: [] };
      }
    }
    return { point, snapped, guides };
  }

  function commitDraft() {
    const s = getState();
    const pts = s.draft?.points || [];
    if (pts.length < 2) {
      setState({ draft: null, numInput: '' });
      return;
    }
    const type = wallType(s.settings.wallTypeId);
    const thickness = type ? typeThickness(type) : s.settings.wallThicknessCm;
    commit((project) => {
      const level = project.levels[levelIndex()];
      for (let i = 0; i < pts.length - 1; i++) {
        if (dist(pts[i], pts[i + 1]) < 1) continue;
        const wall = {
          id: newId('w'),
          a: { ...pts[i] },
          b: { ...pts[i + 1] },
          thicknessCm: thickness,
          heightCm: level.heightCm,
        };
        if (type) wall.typeId = type.id;
        level.walls.push(wall);
      }
    });
    setState({ draft: null, numInput: '', guides: [] });
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
    const offset = Math.max(width / 2, Math.min(total - width / 2, snap(hit.offsetCm, s.settings.snapEnabled ? 5 : 0)));
    if (total < width + 10) {
      toast('Die Wand ist für diese Öffnung zu kurz.', 'warn');
      return;
    }
    const id = newId('op');
    commit((project) => {
      project.levels[levelIndex()].openings.push({
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

  // --- Werkzeug: Moebel, Treppe, Raumstempel -----------------------------

  function placeFurniture(p) {
    const s = getState();
    const item = catalogItem(s.pendingCatalogId);
    if (!item) return;
    const step = s.settings.snapEnabled ? s.settings.gridCm : 0;
    const id = newId('f');
    commit((project) => {
      project.levels[levelIndex()].furniture.push({
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

  function placeStair(p) {
    const s = getState();
    const idx = levelIndex();
    if (idx >= s.project.levels.length - 1) {
      toast('Über diesem Geschoss gibt es keins — die Treppe rechnet mit der Geschosshöhe. Lege oben ein Geschoss an, damit die Deckenöffnung entsteht.', 'warn');
    }
    const step = s.settings.snapEnabled ? s.settings.gridCm : 0;
    const id = newId('st');
    commit((project) => {
      project.levels[idx].stairs.push({
        id,
        kind: 'gerade',
        x: snap(p.x, step),
        y: snap(p.y, step),
        rotationDeg: 0,
        widthCm: DEFAULTS.stairWidthCm,
        treadCm: 0,
        turn: 1,
        splitAt: 0,
      });
    });
    setState({ selection: { kind: 'stair', id }, tool: 'select' });
  }

  function placeRoomStamp(p) {
    const s = getState();
    const idx = levelIndex();
    const d = deriveLevel(s.project, idx);
    const room = d.rooms.find((r) => pointInPolygon(p, r.axis));
    if (!room) {
      toast('Hier ist kein geschlossener Raum. Raumstempel gehören in einen von Wänden umschlossenen Raum.', 'warn');
      return;
    }
    if (room.stamp) {
      setState({ selection: { kind: 'room', id: room.stamp.id }, tool: 'select' });
      return;
    }
    const id = newId('rs');
    commit((project) => {
      project.levels[idx].rooms.push({ id, x: p.x, y: p.y, name: 'Raum', usage: 'wohnen', floor: '' });
    });
    setState({ selection: { kind: 'room', id }, tool: 'select' });
  }

  // --- Werkzeug: Bemaßung -------------------------------------------------

  function dimensionClick(p) {
    const s = getState();
    const level = activeLevel(s);
    const { point } = snapPoint(level, p, s.settings, s.view, [], dimensionPoints(level));
    const dd = s.dimDraft;
    if (!dd?.a) {
      setState({ dimDraft: { a: point, b: null, preview: point, offset: 0 } });
      return;
    }
    if (!dd.b) {
      if (dist(dd.a, point) < 1) return;
      setState({ dimDraft: { ...dd, b: point } });
      return;
    }
    const id = newId('dm');
    commit((project) => {
      project.levels[levelIndex()].dimensions.push({ id, a: dd.a, b: dd.b, offsetCm: dd.offset });
    });
    setState({ dimDraft: null, selection: { kind: 'dimension', id } });
  }

  function dimensionMove(p) {
    const s = getState();
    const dd = s.dimDraft;
    if (!dd?.a) {
      const { snapped } = snapPoint(activeLevel(s), p, s.settings, s.view, [], dimensionPoints(activeLevel(s)));
      setState({ snapPoint: snapped });
      return;
    }
    if (!dd.b) {
      const { point, snapped } = snapPoint(activeLevel(s), p, s.settings, s.view, [], dimensionPoints(activeLevel(s)));
      setState({ dimDraft: { ...dd, preview: point }, snapPoint: snapped });
      return;
    }
    const n = normal(normalize(sub(dd.b, dd.a)));
    const off = (p.x - dd.a.x) * n.x + (p.y - dd.a.y) * n.y;
    setState({ dimDraft: { ...dd, offset: Math.round(off / 5) * 5 } });
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
      setState({ draft: { points: pts, preview: point }, numInput: '' });
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
    if (s.tool === 'stair') {
      placeStair(p);
      return;
    }
    if (s.tool === 'room') {
      placeRoomStamp(p);
      return;
    }
    if (s.tool === 'dimension') {
      dimensionClick(p);
      return;
    }

    // Auswahlwerkzeug
    const derived = deriveLevel(s.project, levelIndex());
    const hit = hitTest(level, p, s.view, s.selection, derived);
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
    } else if (hit.kind === 'stair') {
      const st = level.stairs.find((x) => x.id === hit.id);
      drag = { mode: 'move-stair', id: hit.id, grabOffset: { x: p.x - st.x, y: p.y - st.y }, moved: false };
    } else if (hit.kind === 'room') {
      const r = level.rooms.find((x) => x.id === hit.id);
      drag = { mode: 'move-room', id: hit.id, grabOffset: { x: p.x - r.x, y: p.y - r.y }, moved: false };
    } else if (hit.kind === 'dimension') {
      drag = { mode: 'move-dimension', id: hit.id, moved: false };
    }
  }

  function onPointerMove(ev) {
    const s = getState();
    const p = pointerWorld(ev);

    if (!drag) {
      if (s.tool === 'wall') {
        const { point, snapped, guides } = wallDraftPoint(p, ev);
        if (s.draft) setState({ draft: { ...s.draft, preview: point }, snapPoint: snapped, guides });
        else setState({ snapPoint: snapped, guides });
      } else if (s.tool === 'dimension') {
        dimensionMove(p);
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
    const idx = levelIndex();

    if (drag.mode === 'move-furniture') {
      commit((project) => {
        const f = project.levels[idx].furniture.find((x) => x.id === drag.id);
        if (!f) return false;
        f.x = snap(p.x - drag.grabOffset.x, step);
        f.y = snap(p.y - drag.grabOffset.y, step);
      }, { merge });
      return;
    }

    if (drag.mode === 'rotate-furniture') {
      commit((project) => {
        const f = project.levels[idx].furniture.find((x) => x.id === drag.id);
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
        const f = project.levels[idx].furniture.find((x) => x.id === drag.id);
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
        const w = project.levels[idx].walls.find((x) => x.id === drag.id);
        if (!w) return false;
        w.a = { x: snap(drag.start.a.x + delta.x, step), y: snap(drag.start.a.y + delta.y, step) };
        w.b = { x: snap(drag.start.b.x + delta.x, step), y: snap(drag.start.b.y + delta.y, step) };
      }, { merge });
      return;
    }

    if (drag.mode === 'move-wall-end') {
      const level = activeLevel(s);
      const { point, snapped, guides } = snapPoint(level, p, s.settings, s.view, [drag.id]);
      setState({ snapPoint: snapped, guides });
      commit((project) => {
        const w = project.levels[idx].walls.find((x) => x.id === drag.id);
        if (!w) return false;
        w[drag.end] = { x: point.x, y: point.y };
      }, { merge });
      return;
    }

    if (drag.mode === 'move-opening') {
      commit((project) => {
        const level = project.levels[idx];
        const op = level.openings.find((x) => x.id === drag.id);
        if (!op) return false;
        const wall = level.walls.find((w) => w.id === op.wallId);
        if (!wall) return false;
        const total = wallLength(wall);
        const raw = snap(offsetAlongWall(wall, p), step ? 5 : 0);
        op.offsetCm = Math.max(op.widthCm / 2, Math.min(total - op.widthCm / 2, raw));
      }, { merge });
      return;
    }

    if (drag.mode === 'move-stair' || drag.mode === 'move-room') {
      const key = drag.mode === 'move-stair' ? 'stairs' : 'rooms';
      commit((project) => {
        const o = project.levels[idx][key].find((x) => x.id === drag.id);
        if (!o) return false;
        o.x = snap(p.x - drag.grabOffset.x, step);
        o.y = snap(p.y - drag.grabOffset.y, step);
      }, { merge });
      return;
    }

    if (drag.mode === 'move-dimension') {
      commit((project) => {
        const dm = project.levels[idx].dimensions.find((x) => x.id === drag.id);
        if (!dm) return false;
        const n = normal(normalize(sub(dm.b, dm.a)));
        dm.offsetCm = Math.round(((p.x - dm.a.x) * n.x + (p.y - dm.a.y) * n.y) / 5) * 5;
      }, { merge });
    }
  }

  function onPointerUp(ev) {
    canvas.releasePointerCapture?.(ev.pointerId);
    drag = null;
    setState({ snapPoint: null, guides: [] });
  }

  function onWheel(ev) {
    ev.preventDefault();
    const s = getState();
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    // Trackpad-Pinch kommt als Rad mit Strg; zwei Finger ohne Strg verschieben.
    if (!ev.ctrlKey && Math.abs(ev.deltaX) > 0.5 && ev.deltaMode === 0) {
      setState({ view: { ...s.view, panX: s.view.panX - ev.deltaX, panY: s.view.panY - ev.deltaY } });
      return;
    }
    const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
    const zoom = Math.min(8, Math.max(0.03, s.view.zoom * factor));
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
    if (s.tool === 'dimension') setState({ dimDraft: null });
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
  finishDraftRef.current = commitDraft;

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
      if (finishDraftRef.current === commitDraft) finishDraftRef.current = null;
    },
  };
}

/** Damit Enter auf der Tastatur einen Wandzug auch ohne Mausklick abschliesst. */
export const finishDraftRef = { current: null };
