/**
 * Count how many of `incomingIds` are NOT already in `existingIds`, after
 * de-duplicating the incoming list. Used to gate batch reorder-rule creation:
 * an upsert over a list only adds net-new variants, so the quota check must
 * count those, not the raw submitted length.
 */
export function countNetNew(
  incomingIds: string[],
  existingIds: Set<string>,
): number {
  const unique = new Set(incomingIds);
  let count = 0;
  for (const id of unique) {
    if (!existingIds.has(id)) count += 1;
  }
  return count;
}
