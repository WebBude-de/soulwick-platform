/**
 * Runs `fn` for each item strictly one after the other. For steps inside one transaction that
 * depend on the previous step (counters, founder hand-over), where `Promise.all` would interleave.
 */
export async function forEachSequential<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>
): Promise<void> {
  await items.reduce<Promise<void>>(
    (previous, item) => previous.then(() => fn(item)),
    Promise.resolve()
  );
}
