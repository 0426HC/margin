/** Week numbers, sorted, without repeats. */
export const weekSet = (weeks: Iterable<number>) => [...new Set(weeks)].sort((a, b) => a - b);
