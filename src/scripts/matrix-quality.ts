/** Conservative quality control based on sustained measured Matrix drawing cost.
 * Neither GPU names nor unrelated main-thread stalls are evidence of slow rain.
 */
export class MatrixQuality {
  level: 0 | 1 | 2 = 0;
  private samples = 0;
  private expensive = 0;
  private cheap = 0;
  private lastChange = 0;

  get frameInterval(): number {
    return this.level === 0 ? 1000 / 60 : this.level === 1 ? 1000 / 30 : 1000;
  }

  get scale(): number {
    return this.level === 0 ? 1 : this.level === 1 ? 0.7 : 0.5;
  }

  /** Returns true only when the raster budget needs to be applied again. */
  record(costMs: number, now: number): boolean {
    if (!Number.isFinite(costMs) || !Number.isFinite(now) || costMs < 0)
      return false;
    if (this.level === 2 && now - this.lastChange >= 8000) {
      this.change(1, now);
      return true;
    }
    this.samples++;
    if (costMs >= (this.level === 0 ? 12 : 24)) this.expensive++;
    if (costMs <= 5) this.cheap++;
    if (this.samples < 90) return false;
    const stressed = this.expensive >= 63;
    const recovered = this.cheap >= 80;
    this.samples = this.expensive = this.cheap = 0;
    if (stressed && this.level < 2 && now - this.lastChange >= 1000) {
      this.change((this.level + 1) as 1 | 2, now);
      return true;
    }
    if (recovered && this.level === 1 && now - this.lastChange >= 10_000) {
      this.change(0, now);
      return true;
    }
    return false;
  }

  private change(level: 0 | 1 | 2, now: number): void {
    this.level = level;
    this.lastChange = now;
    this.samples = this.expensive = this.cheap = 0;
  }
}
