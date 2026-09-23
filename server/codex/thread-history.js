import {mergeTurnItems} from '../../web/shared/turn-items.js';

// Summary views drop in-turn followups and activity. Preserve the complete timeline.
export function conversationTurn(turn) {
  return {...turn, items: turn.items || []};
}

export async function readConversationTurns(request, params) {
  const page = await request('thread/turns/list', {...params, itemsView: 'full'});
  return {...page, data: page.data.map(conversationTurn)};
}

export function mergeConversationTurns(history, desktop, paginated = false) {
  const time = turn => turn.createdAt ?? turn.startedAtMs ?? (turn.startedAt == null ? 0 : turn.startedAt * 1000);
  const oldest = history.length ? Math.min(...history.map(time)) : Infinity;
  const turns = new Map(history.map(turn => [turn.id, conversationTurn(turn)]));
  for (const native of desktop) {
    if (paginated && !turns.has(native.id) && time(native) < oldest && native.status !== 'inProgress') continue;
    const turn = conversationTurn(native), previous = turns.get(turn.id);
    turns.set(turn.id, {...previous, ...turn, items: mergeTurnItems(previous?.items, turn.items)});
  }
  return [...turns.values()].sort((a, b) => time(a) - time(b));
}

export async function readThreadPage(request, threadId) {
  const [metadata, page] = await Promise.all([
    request("thread/read", {threadId, includeTurns: false}),
    readConversationTurns(request, {threadId, limit: 20, sortDirection: "desc"}),
  ]);
  return {...metadata, thread: {...metadata.thread, turns: [...page.data].reverse(), olderTurnsCursor: page.nextCursor ?? null}};
}
