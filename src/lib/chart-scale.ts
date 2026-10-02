/** Smallest "nice" axis maximum (4 ticks of 1, 2, 2.5 or 5 × 10^n) that fits v. */
export function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= v)!;
  return step * 4;
}
