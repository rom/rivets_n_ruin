// Fixed-capacity pool with swap-remove. No allocation during play.
// Iterate downward (`for (let i = p.count - 1; i >= 0; i--)`) so kills are safe.
export function makePool(size, factory) {
  const items = new Array(size);
  for (let i = 0; i < size; i++) items[i] = factory();
  let n = 0;
  return {
    items,
    get count() { return n; },
    spawn() { return n >= items.length ? null : items[n++]; },
    kill(i) {
      n--;
      const t = items[i]; items[i] = items[n]; items[n] = t;
    },
    clear() { n = 0; },
  };
}
