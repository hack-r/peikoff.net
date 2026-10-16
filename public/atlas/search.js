// Atlas search order and the red rule. Pure helpers (no DOM, no three.js) so they can be tested in node.

const rank = (hay, t) => hay.startsWith(t) ? 0 : hay.includes(' ' + t) ? 1 : hay.includes(t) ? 2 : 3;   // name start > word start > anywhere

/**
 * Rows of the search index ({ label, hay, ... }) that match the folded text `t` (every word somewhere), best match first.
 * Equal matches put `preferred(row)` first, then go A to Z: "Leonard" lists Leonard Peikoff before Leonard Esmond.
 */
export function orderHits(rows, t, preferred = () => false) {
  const words = t.split(/\s+/);
  return rows.filter(r => words.every(w => r.hay.includes(w))).map(r => ({ r, s: rank(r.hay, t), p: preferred(r) ? 0 : 1 }))
    .sort((a, b) => a.s - b.s || a.p - b.p || a.r.label.localeCompare(b.r.label)).map(o => o.r);
}

/** The red rule: only Peikoffs are drawn red. `ids` are the highlight group's person ids, `meta` the people's cards (meta[id].Name). */
export const peikoffsOnly = (ids, meta) => ids.filter(id => /peikoff/i.test(String(meta?.[id]?.Name ?? '')));
