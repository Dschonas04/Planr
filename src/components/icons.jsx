// Inline-SVG statt Emoji: Unicode-Symbole fallen je nach Schriftart auf
// leere Kaesten zurueck, SVG sieht ueberall gleich aus.

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const IconSelect = () => (
  <svg {...base}>
    <path d="M3 2l9 5.5-4 1-1.6 4z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconWall = () => (
  <svg {...base}>
    <rect x="1.5" y="6" width="13" height="4" />
    <path d="M6 6v4M10.5 6v4" />
  </svg>
);

export const IconDoor = () => (
  <svg {...base}>
    <path d="M3 13V3h6.5v10" />
    <path d="M9.5 13a6.5 6.5 0 00-6.5-6.5" strokeDasharray="2 1.6" />
  </svg>
);

export const IconWindow = () => (
  <svg {...base}>
    <rect x="2" y="4" width="12" height="8" />
    <path d="M8 4v8M2 8h12" />
  </svg>
);

export const IconPan = () => (
  <svg {...base}>
    <path d="M8 2v12M2 8h12" />
    <path d="M8 2L6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" />
  </svg>
);

export const IconUndo = () => (
  <svg {...base}>
    <path d="M4 7H10a3.5 3.5 0 010 7H7" />
    <path d="M6.5 4.5L4 7l2.5 2.5" />
  </svg>
);

export const IconRedo = () => (
  <svg {...base}>
    <path d="M12 7H6a3.5 3.5 0 000 7h3" />
    <path d="M9.5 4.5L12 7l-2.5 2.5" />
  </svg>
);

export const IconLogo = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2" y="2.5" width="16" height="15" rx="1.5" />
    <path d="M10 2.5v15M2 10h8" />
  </svg>
);
