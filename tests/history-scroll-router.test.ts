import { describe, expect, it, beforeEach } from "bun:test";
import {
  handlePopState,
  setupHistoryScrollRouter,
} from "../src/lib/navigation/history-scroll-router";

describe("History Scroll Router (Fluid Back/Forward In-Page Navigation)", () => {
  let mockWindow: any;
  let mockDocument: any;
  let scrollCalls: Array<{ top: number; behavior: string }>;

  beforeEach(() => {
    scrollCalls = [];
    mockDocument = {
      location: {
        pathname: "/",
        hash: "",
      },
      documentElement: {
        scrollTop: 0,
        classList: {
          add: () => {},
          remove: () => {},
        },
      },
      body: { scrollTop: 0 },
      getElementById(id: string) {
        if (id === "experience") {
          return {
            id: "experience",
            getBoundingClientRect: () => ({ top: 800 }),
          };
        }
        if (id === "site-header") {
          return {
            offsetHeight: 64,
          };
        }
        return null;
      },
      querySelector() {
        return null;
      },
    };

    mockWindow = {
      location: mockDocument.location,
      pageYOffset: 0,
      scrollTo(options: { top: number; behavior: string }) {
        scrollCalls.push(options);
        mockWindow.pageYOffset = options.top;
      },
      matchMedia(query: string) {
        return { matches: false };
      },
      addEventListener() {},
      removeEventListener() {},
    };
  });

  it("returns false if window or document is missing", () => {
    expect(
      handlePopState(null, { window: undefined, document: undefined }),
    ).toBe(false);
  });

  it("smoothly scrolls to section target when navigating back to a hash (e.g. #experience)", () => {
    mockWindow.location.hash = "#experience";
    mockWindow.pageYOffset = 1500;

    let highlightedId = "";
    mockWindow.__highlightPageIndexActive = (id: string) => {
      highlightedId = id;
    };

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(true);
    expect(scrollCalls.length).toBe(1);
    // element position 800 + scroll 1500 - headerOffset 64 = 2236
    expect(scrollCalls[0]?.top).toBe(2236);
    expect(scrollCalls[0]?.behavior).toBe("smooth");
    expect(highlightedId).toBe("experience");
  });

  it("delegates to __smoothScrollToContact when hash is #contact", () => {
    mockWindow.location.hash = "#contact";
    let contactCalled = false;
    mockWindow.__smoothScrollToContact = () => {
      contactCalled = true;
    };

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(true);
    expect(contactCalled).toBe(true);
    expect(scrollCalls.length).toBe(0);
  });

  it("delegates to __pageIndexScrollToTarget when available", () => {
    mockWindow.location.hash = "#experience";
    let targetCalledWith = "";
    let skipPush = false;
    mockWindow.__pageIndexScrollToTarget = (id: string, skip: boolean) => {
      targetCalledWith = id;
      skipPush = skip;
    };

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(true);
    expect(targetCalledWith).toBe("experience");
    expect(skipPush).toBe(true);
  });

  it("smoothly scrolls to top when returning to base page with no hash and scrollY > 40", () => {
    mockWindow.location.hash = "";
    mockWindow.pageYOffset = 800;

    let highlightedId = "";
    mockWindow.__highlightPageIndexActive = (id: string) => {
      highlightedId = id;
    };

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(true);
    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]?.top).toBe(0);
    expect(scrollCalls[0]?.behavior).toBe("smooth");
    expect(highlightedId).toBe("about");
  });

  it("delegates to __pageIndexScrollToTop when returning to top", () => {
    mockWindow.location.hash = "";
    mockWindow.pageYOffset = 600;

    let topCalled = false;
    mockWindow.__pageIndexScrollToTop = () => {
      topCalled = true;
    };

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(true);
    expect(topCalled).toBe(true);
  });

  it("smoothly scrolls to top when returning to #role-header in experience detail page", () => {
    mockWindow.location.hash = "#role-header";
    mockWindow.pageYOffset = 900;

    let highlightedId = "";
    mockWindow.__highlightPageIndexActive = (id: string) => {
      highlightedId = id;
    };

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(true);
    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]?.top).toBe(0);
    expect(scrollCalls[0]?.behavior).toBe("smooth");
    expect(highlightedId).toBe("role-header");
  });

  it("returns false without scrolling if already at top (scrollY <= 40) when hash is empty", () => {
    mockWindow.location.hash = "";
    mockWindow.pageYOffset = 10;

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(false);
    expect(scrollCalls.length).toBe(0);
  });

  it("respects prefers-reduced-motion by using behavior: auto", () => {
    mockWindow.location.hash = "#experience";
    mockWindow.pageYOffset = 1000;
    mockWindow.matchMedia = (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
    });

    const handled = handlePopState(null, {
      window: mockWindow,
      document: mockDocument,
    });

    expect(handled).toBe(true);
    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]?.behavior).toBe("auto");
  });
});
