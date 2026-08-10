import { useMemo, useState } from 'react';
import { CATALOG, CATEGORIES } from '../model/catalog.ts';
import { setState, useStore } from '../store.js';
import { formatLength } from '../model/units.ts';

export default function CatalogPanel() {
  const state = useStore();
  const [query, setQuery] = useState('');
  const [openCat, setOpenCat] = useState('schlafen');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return CATALOG.filter((c) => c.label.toLowerCase().includes(q));
  }, [query]);

  const pick = (item) => {
    // Der naechste Klick auf den Plan setzt das Objekt ab.
    setState({ tool: 'place', pendingCatalogId: item.id, draft: null });
  };

  const renderItem = (item) => (
    <button
      key={item.id}
      type="button"
      className={`catalog-item ${state.pendingCatalogId === item.id ? 'active' : ''}`}
      onClick={() => pick(item)}
      title={`${item.label} — ${item.w}×${item.d}×${item.h} cm`}
    >
      <span className="swatch" style={{ background: item.color }} />
      <span className="catalog-label">{item.label}</span>
      <span className="catalog-dims">
        {formatLength(item.w)} × {formatLength(item.d)}
      </span>
    </button>
  );

  return (
    <aside className="panel catalog">
      <h2>Möbel</h2>
      <input
        className="search"
        type="search"
        placeholder="Suchen …"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {state.tool === 'place' && state.pendingCatalogId && (
        <p className="hint">Auf den Plan klicken zum Platzieren. Esc bricht ab.</p>
      )}

      {results ? (
        <div className="catalog-list">
          {results.length ? results.map(renderItem) : <p className="empty">Nichts gefunden.</p>}
        </div>
      ) : (
        CATEGORIES.map((cat) => {
          const items = CATALOG.filter((c) => c.cat === cat.id);
          const open = openCat === cat.id;
          return (
            <section key={cat.id} className="catalog-section">
              <button
                type="button"
                className={`catalog-head ${open ? 'open' : ''}`}
                onClick={() => setOpenCat(open ? null : cat.id)}
              >
                <span>{cat.label}</span>
                <span className="count">{items.length}</span>
              </button>
              {open && <div className="catalog-list">{items.map(renderItem)}</div>}
            </section>
          );
        })
      )}
    </aside>
  );
}
