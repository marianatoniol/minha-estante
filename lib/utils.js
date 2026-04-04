export const COVER_GRADIENTS = [
  "linear-gradient(135deg,#2d1b4e,#6b3fa0,#c084fc)",
  "linear-gradient(135deg,#1a3a5c,#3b7dd8,#93c5fd)",
  "linear-gradient(135deg,#4a1c1c,#8b2525,#ef4444)",
  "linear-gradient(135deg,#1c3a2a,#2d6b4a,#4ade80)",
  "linear-gradient(135deg,#3d2b1f,#8b6b47,#d4a574)",
  "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)",
  "linear-gradient(135deg,#5c1a1a,#b22222,#e74c3c)",
  "linear-gradient(135deg,#1a1a3e,#3d3d8e,#7b68ee)",
  "linear-gradient(135deg,#1c3a3a,#2e7d7d,#4fd1c5)",
  "linear-gradient(135deg,#3a1c3a,#7d2e7d,#c54fd1)",
];

export function getGradient(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  return COVER_GRADIENTS[Math.abs(hash) % COVER_GRADIENTS.length];
}

export function getSimilarity(a, b) {
  const at = new Set(a.tropes || []);
  const bt = new Set(b.tropes || []);
  const intersection = [...at].filter(x => bt.has(x)).length;
  const union = new Set([...at, ...bt]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 100);
}

export function filterBooks(books, { statusFilter = "", search = "" } = {}) {
  return books.filter(b => {
    if (statusFilter && b.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return b.title.toLowerCase().includes(q)
        || b.authors?.join(" ").toLowerCase().includes(q)
        || b.tropes?.some(t => t.includes(q))
        || b.genres?.some(g => g.includes(q));
    }
    return true;
  });
}
