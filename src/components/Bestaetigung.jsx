import { bestaetigungBeantworten, useStore } from '../store.js';

export default function Bestaetigung() {
  const b = useStore((s) => s.bestaetigung);
  if (!b) return null;
  return (
    <div className="board-backdrop" onPointerDown={() => bestaetigungBeantworten(false)}>
      <div className="board-dialog bestaetigung" onPointerDown={(e) => e.stopPropagation()} role="alertdialog">
        <p>{b.text}</p>
        <div className="knopfreihe">
          <button type="button" onClick={() => bestaetigungBeantworten(false)}>
            Abbrechen
          </button>
          <button type="button" className="knopf-primaer danger" autoFocus onClick={() => bestaetigungBeantworten(true)}>
            {b.ja}
          </button>
        </div>
      </div>
    </div>
  );
}
