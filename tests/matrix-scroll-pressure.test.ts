import { describe, expect, test } from "bun:test";
import { MatrixScrollPressure } from "../src/scripts/matrix-scroll-pressure";

const feed = (detector: MatrixScrollPressure, gap: number, count = 24) => {
  let result = "visible";
  for (let i = 0; i < count; i++) result = detector.sample(gap);
  return result;
};

describe("scroll pressure attribution", () => {
  test("fast software frames retain the decoration indefinitely", () => {
    const detector = new MatrixScrollPressure();
    for (let i = 0; i < 240; i++) expect(detector.sample(17)).toBe("visible");
  });

  test("typical fast frames with occasional vsync misses do not trigger a doomed trial blink", () => {
    const detector = new MatrixScrollPressure();
    for (let windowIndex = 0; windowIndex < 4; windowIndex++) {
      for (let i = 0; i < 24; i++) {
        expect(detector.sample(i < 17 ? 17 : 33)).toBe("visible");
      }
    }
  });

  test("sustained slow presentation trials off then reconfirms on before disabling", () => {
    const detector = new MatrixScrollPressure();
    expect(feed(detector, 33, 23)).toBe("visible");
    expect(detector.sample(33)).toBe("trial");
    expect(feed(detector, 17)).toBe("visible");
    expect(feed(detector, 33)).toBe("disabled");
    expect(detector.sample(17)).toBe("disabled");
    detector.stop();
    expect(detector.state).toBe("disabled");
  });

  test("a real off trial with intermittent scroll misses still detects a typical-frame gain", () => {
    const detector = new MatrixScrollPressure();
    expect(feed(detector, 33)).toBe("trial");
    for (let i = 0; i < 24; i++) {
      detector.sample(i < 14 ? 17 : 33);
    }
    expect(detector.state).toBe("visible");
    expect(feed(detector, 33)).toBe("disabled");
  });

  test("an unrelated transient stall and an inconclusive trial do not disable", () => {
    const detector = new MatrixScrollPressure();
    feed(detector, 17, 22);
    detector.sample(150);
    expect(detector.sample(17)).toBe("visible");
    expect(feed(detector, 33)).toBe("trial");
    expect(feed(detector, 33)).toBe("visible");
    expect(feed(detector, 33)).toBe("visible");
  });

  test("aborted trial restores immediately, with a bounded cooldown", () => {
    const detector = new MatrixScrollPressure();
    expect(feed(detector, 33)).toBe("trial");
    detector.stop();
    expect(detector.state).toBe("visible");
    expect(feed(detector, 33)).toBe("visible");
    detector.cooldownElapsed();
    expect(feed(detector, 33)).toBe("trial");
  });

  test("scroll pause after an inconclusive trial preserves cooldown until elapsed", () => {
    const detector = new MatrixScrollPressure();
    expect(feed(detector, 33)).toBe("trial");
    expect(feed(detector, 33)).toBe("visible");
    expect(detector.isCooling).toBe(true);
    detector.stop();
    expect(detector.isCooling).toBe(true);
    expect(feed(detector, 33)).toBe("visible");
    detector.cooldownElapsed();
    expect(detector.isCooling).toBe(false);
    expect(feed(detector, 33)).toBe("trial");
  });

  test("settles permanently after two completed inconclusive trials instead of probing forever", () => {
    const detector = new MatrixScrollPressure();
    expect(feed(detector, 33)).toBe("trial");
    expect(feed(detector, 33)).toBe("visible");
    expect(detector.isSettled).toBe(false);
    detector.cooldownElapsed();
    expect(feed(detector, 33)).toBe("trial");
    expect(feed(detector, 33)).toBe("visible");
    expect(detector.isSettled).toBe(true);
    detector.cooldownElapsed();
    expect(feed(detector, 33)).toBe("visible");
  });
});
