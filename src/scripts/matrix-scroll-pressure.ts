// Scroll presentation attribution; never uses renderer or hardware identity.
export type MatrixPressureState = "visible" | "trial" | "disabled";

const WINDOW = 24;
const MAX_INCONCLUSIVE_TRIALS = 2;
const summarize = (gaps: number[]) => {
  const sorted = [...gaps].sort((a, b) => a - b);
  return { median: sorted[11]!, p75: sorted[17]! };
};

export class MatrixScrollPressure {
  state: MatrixPressureState = "visible";
  private phase: "on" | "off" | "confirm" = "on";
  private gaps: number[] = [];
  private onGap = 0;
  private onP75 = 0;
  private offGap = 0;
  private cooling = false;
  private inconclusiveTrials = 0;

  get isCooling(): boolean {
    return this.cooling;
  }

  get isSettled(): boolean {
    return (
      this.state === "disabled" ||
      this.inconclusiveTrials >= MAX_INCONCLUSIVE_TRIALS
    );
  }

  sample(gap: number): MatrixPressureState {
    if (this.isSettled || this.cooling) return this.state;
    // Ignore suspended-tab / navigation stalls, not evidence about scrolling.
    if (!Number.isFinite(gap) || gap <= 0 || gap > 200) {
      this.gaps = [];
      return this.state;
    }
    this.gaps.push(gap);
    if (this.gaps.length < WINDOW) return this.state;
    const { median, p75 } = summarize(this.gaps);
    if (this.phase === "on") {
      if (median < 28) {
        this.gaps = [];
        return this.state;
      }
      this.onGap = median;
      this.onP75 = p75;
      this.phase = "off";
      this.gaps = [];
      this.state = "trial";
    } else if (this.phase === "off") {
      this.offGap = median;
      this.phase = "confirm";
      this.gaps = [];
      this.state = "visible";
      // Composition may take a few frames to settle. Demand a clear typical-frame
      // gain without worsening the slower quarter of presented frames.
      if (
        this.onGap - median < 6 ||
        median > this.onGap * 0.75 ||
        p75 > this.onP75 + 1
      ) {
        this.inconclusiveTrials++;
        this.reset(!this.isSettled);
      }
    } else {
      if (
        median >= 28 &&
        median - this.offGap >= 6 &&
        median >= this.offGap * 1.25
      ) {
        this.state = "disabled";
      } else {
        this.inconclusiveTrials++;
        this.reset(!this.isSettled);
      }
    }
    return this.state;
  }

  stop(): void {
    if (this.isSettled) return;
    this.reset(this.cooling || this.phase !== "on");
  }

  cooldownElapsed(): void {
    this.cooling = false;
  }

  private reset(cool: boolean): void {
    this.state = "visible";
    this.phase = "on";
    this.gaps = [];
    this.cooling = cool;
  }
}
