export interface Hit { doc_id: string; index_id: number; score: number }

/** Positive means a ranks ahead of b. Ties match trec_eval's score ordering. */
export function compareHits(a: Hit, b: Hit): number {
  return a.score - b.score || (a.doc_id === b.doc_id ? 0 : a.doc_id > b.doc_id ? 1 : -1);
}

export class TopK {
  readonly hits: Hit[] = [];
  constructor(readonly k: number) {
    if (!Number.isInteger(k) || k < 1) throw new Error("k must be a positive integer");
  }
  add(hit: Hit) {
    const heap = this.hits;
    if (heap.length < this.k) {
      heap.push(hit);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >>> 1;
        if (compareHits(heap[parent]!, heap[i]!) <= 0) break;
        [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
        i = parent;
      }
      return;
    }
    if (compareHits(hit, heap[0]!) <= 0) return;
    heap[0] = hit;
    let i = 0;
    while (i * 2 + 1 < heap.length) {
      const left = i * 2 + 1;
      const right = left + 1;
      const smaller = right < heap.length && compareHits(heap[right]!, heap[left]!) < 0 ? right : left;
      if (compareHits(heap[i]!, heap[smaller]!) <= 0) break;
      [heap[i], heap[smaller]] = [heap[smaller]!, heap[i]!];
      i = smaller;
    }
  }
  sorted(): Hit[] { return [...this.hits].sort((a, b) => compareHits(b, a)); }
}
