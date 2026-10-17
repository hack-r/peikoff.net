// Taller floors. The data has 3.5 m floors, but people are drawn about 5.9 tall at the default size (the slider makes them bigger than life), which put their heads through the
// ceiling and into the floor above. Every multi-storey building, and every person's floor, is stretched by the same factor on load, so all buildings stay consistent and a figure of the
// default size fits with headroom. Pure maths on plain data, unit-tested in node.
export const FLOOR_H = 6.5;                    // scene units per floor after stretching (default figure 1.95 x 3 = 5.85 tall)

/** Stretch the city's floors to `fh` in place; returns the factor. `m` on each building keeps its true height for the cards. */
export function stretchFloors(city, fh = FLOOR_H) {
  const f = fh / city.floor_h;
  if (Math.abs(f - 1) < 1e-9) return 1;
  for (const b of city.buildings) { b.m = b.h; b.h *= f; }
  for (const p of city.people) p[2] *= f;
  city.floor_h = fh;
  return f;
}
