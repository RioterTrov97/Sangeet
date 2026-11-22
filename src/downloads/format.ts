export const fmtBytes = (n: number): string => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

const fmtBudget = (mb: number): string => (mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`);

/** "312 MB of 1 GB" (or "312 MB, no limit" when the budget is unlimited, "312 MB, off" when automatic saving is off). */
export function autoUsage(bytes: number, budgetMb: number): string {
  return budgetMb > 0 ? `${fmtBytes(bytes)} of ${fmtBudget(budgetMb)}` : `${fmtBytes(bytes)}, automatic saving is off`;
}
