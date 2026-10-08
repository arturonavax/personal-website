import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.resolve(__dirname, "../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT_DIR, rel), "utf-8");

describe("SPEC-009 REQ-UXE-32: Keyboard Input Isolation in PageIndexNav", () => {
  it("strictly shields typing in inputs, textareas, selects, and contenteditable elements", () => {
    const content = read("src/components/ui/PageIndexNav.astro");

    // Must check activeElement and target tags
    expect(content).toContain('tag === "INPUT"');
    expect(content).toContain('tag === "TEXTAREA"');
    expect(content).toContain('tag === "SELECT"');
    expect(content).toContain('targetTag === "INPUT"');
    expect(content).toContain('targetTag === "TEXTAREA"');
    expect(content).toContain('targetTag === "SELECT"');
    expect(content).toContain("active.isContentEditable");
    expect(content).toContain("target.isContentEditable");

    // Must early exit on input focus before checking 'i' or 'p' keys
    expect(content).toContain("if (isInputFocused) return;");

    // Must check if any modal is open
    expect(content).toContain('dialog[open], [role="dialog"]:not(.hidden)');
    expect(content).toContain("if (isModalOpen) return;");

    // Must check modifier keys
    expect(content).toContain(
      "if (e.ctrlKey || e.metaKey || e.altKey) return;",
    );
  });
});

describe("SPEC-009 REQ-UXE-33: Immediate Scroll Detection in Coffee Modal", () => {
  it("CoffeeSponsorshipModal employs dynamic lookup, MutationObserver, ResizeObserver, and multi-stage layout timing", () => {
    const content = read("src/components/ui/CoffeeSponsorshipModal.astro");

    // Dynamic resolution
    expect(content).toContain(
      'var sb = document.getElementById("coffee-dialog-scroll");',
    );
    expect(content).toContain(
      'var sh = document.getElementById("coffee-scroll-hint");',
    );

    // Reactivity observers
    expect(content).toContain('"ResizeObserver" in window');
    expect(content).toContain('"MutationObserver" in window');
    expect(content).toContain('attributeFilter: ["open"]');

    // Global hook and resize binding
    expect(content).toContain(
      "window.__updateCoffeeScrollHint = updateCoffeeScrollHint;",
    );
    expect(content).toContain("window.__coffeeResizeBound");

    // Multi-tick open trigger
    expect(content).toContain("updateCoffeeScrollHint();");
    expect(content).toContain("setTimeout(updateCoffeeScrollHint, 50);");
  });
});

describe("SPEC-009 REQ-UXE-34: Shortcuts Modal Footer Cleanliness & Ergonomics", () => {
  it("removes misleading J K scroll indicator from ShortcutsModal footer", () => {
    const content = read("src/components/ui/ShortcutsModal.astro");

    // Does not have j or k keycaps in footer
    expect(content).not.toMatch(/<kbd[^>]*>\s*j\s*<\/kbd>/);
    expect(content).not.toMatch(/<kbd[^>]*>\s*k\s*<\/kbd>/);
    expect(content).not.toContain('<span>{isEs ? "scroll" : "scroll"}</span>');

    // Retains Esc key closing indication
    expect(content).toContain(
      '{isEs ? "Presiona Esc para cerrar" : "Press Esc to close"}',
    );

    // Employs ResizeObserver on scrollable grid
    expect(content).toContain('"ResizeObserver" in window');
  });
});
