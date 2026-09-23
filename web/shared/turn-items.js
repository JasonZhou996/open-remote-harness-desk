// A snapshot supplies canonical order. Keep items absent from a partial snapshot
// beside their next known neighbour (including live events newer than a read).
export function mergeTurnItem(previous, item) {
  const merged = {...previous, ...item};
  if (item.type === 'agentMessage' && item.content !== undefined && item.text === undefined) delete merged.text;
  return merged;
}

export function mergeTurnItems(previous = [], incoming = []) {
  const old = new Map(previous.map(item => [item.id, item]));
  const ids = new Set(incoming.map(item => item.id)), before = new Map();
  let pending = [];
  for (const item of previous) {
    if (!ids.has(item.id)) pending.push(item);
    else { before.set(item.id, pending); pending = []; }
  }
  return incoming.flatMap(item => [...(before.get(item.id) || []), mergeTurnItem(old.get(item.id), item)]).concat(pending);
}
