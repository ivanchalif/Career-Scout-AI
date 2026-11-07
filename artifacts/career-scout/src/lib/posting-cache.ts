type PostingItem = { posting: { id: number; [key: string]: unknown }; [key: string]: unknown };
type PostingPage = { items: PostingItem[]; total: number };

/** Shared by legacy arrays and paginated dashboard queries. */
export function removePostingFromCache(old: unknown, id: number): unknown {
  if (Array.isArray(old)) return old.filter(item => item?.posting?.id !== id);
  if (!old || typeof old !== "object" || !("items" in old) || !Array.isArray(old.items)) return old;
  const page = old as PostingPage;
  const items = page.items.filter(item => item.posting.id !== id);
  return items.length === page.items.length ? old : { ...page, items, total: Math.max(0, page.total - 1) };
}

export function updateDismissalReasonInCache(old: unknown, id: number, feedback: unknown): unknown {
  const update = (items: PostingItem[]) => items.map(item =>
    item.posting.id === id ? { ...item, feedback } : item);
  if (Array.isArray(old)) return update(old);
  if (!old || typeof old !== "object" || !("items" in old) || !Array.isArray(old.items)) return old;
  return { ...old, items: update(old.items) };
}
