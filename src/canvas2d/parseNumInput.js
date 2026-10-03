/** Zahleneingabe "450", "450;90" oder "450<90" in Länge und optionalen Winkel. */
export function parseNumInput(text) {
  const m = text.replace(',', '.').match(/^\s*(\d+(?:\.\d+)?)\s*(?:[;<]\s*(-?\d+(?:[.,]\d+)?))?\s*$/);
  if (!m) return null;
  const length = Number(m[1]);
  const angle = m[2] != null ? Number(m[2].replace(',', '.')) : null;
  if (!(length > 0)) return null;
  return { length, angle };
}

