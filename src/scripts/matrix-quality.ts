/** Conservative quality control based on sustained measured Matrix drawing cost.
 * Neither GPU names nor unrelated main-thread stalls are evidence of slow rain.
 */
export class MatrixQuality {
  level: 0 | 1 | 2 = 0;
  private minimumLevel: 0 | 1 | 2 = 0;
  private get effectiveLevel(): 0 | 1 | 2 {
    return Math.max(this.level, this.minimumLevel) as 0 | 1 | 2;
  }

  setMinimumLevel(level: 0 | 1 | 2): boolean {
    if (level === this.minimumLevel) return false;
    const before = this.effectiveLevel;
    this.minimumLevel = level;
    return before !== this.effectiveLevel;
  }

  private samples = 0;
  private expensive = 0;
  private cheap = 0;
  private lastChange = 0;

  get frameInterval(): number {
    return this.effectiveLevel === 0
      ? 1000 / 60
      : this.effectiveLevel === 1
        ? 1000 / 30
        : 1000;
  }

  get scale(): number {
    return this.effectiveLevel === 0
      ? 1
      : this.effectiveLevel === 1
        ? 0.7
        : 0.5;
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
    if (costMs >= (this.effectiveLevel === 0 ? 12 : 24)) this.expensive++;
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

/** A brief on/off scroll trial attributes slow presentation to the decoration.
 * No GPU-name sniffing or permanent quality downgrade from unrelated stalls.
 */
export class MatrixScrollQuality {
  private stage: "baseline" | "half" | "static" | "confirmed" | "rejected" =
    "baseline";
  private gaps: number[] = [];
  private baseline = 0;
  private rejectUntil = 0;

  record(gap: number, now: number): 0 | 1 | 2 | undefined {
    if (
      !Number.isFinite(gap) ||
      gap <= 0 ||
      !Number.isFinite(now) ||
      this.stage === "confirmed" ||
      this.stage === "rejected"
    )
      return;
    this.gaps.push(gap);
    if (this.gaps.length < 24) return;
    const sorted = this.gaps.sort((a, b) => a - b);
    const p75 = sorted[18]!;
    this.gaps = [];
    if (this.stage === "baseline") {
      if (now < this.rejectUntil || p75 < 30) return;
      this.baseline = p75;
      this.stage = "half";
      return 1;
    }
    if (p75 <= this.baseline * 0.8) {
      this.stage = "confirmed";
      return this.lastTrial;
    }
    if (this.stage === "half") {
      this.stage = "static";
      this.lastTrial = 2;
      return 2;
    }
    this.stage = "rejected";
    this.rejectUntil = now + 8000;
    return 0;
  }

  private lastTrial: 1 | 2 = 1;

  reset(): 0 {
    this.stage = "baseline";
    this.gaps = [];
    this.baseline = 0;
    this.lastTrial = 1;
    return 0;
  }
}
