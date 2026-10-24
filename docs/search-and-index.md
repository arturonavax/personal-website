# Search and responsive page index

Search keeps one actual `<universal-search-modal>` DOM root across Astro navigation. The persistence directive belongs on that root, not only on its Astro component call. Its lazy index cache and input/result listeners therefore remain attached to the same nodes.

Locale changes must preserve the search dialog's inner controls. Existing `astro:page-load` localization updates their copy, placeholders and destination URLs; replacing `innerHTML` would detach the search engine's listeners.

## Page index labels

| Mode                      | English label | Spanish label |
| ------------------------- | ------------- | ------------- |
| Floating, below 640px     | Index         | Índice        |
| Floating, 640px and wider | Page Index    | Índice        |
| Desktop-left aside        | Page Index    | Índice        |

The desktop-left placement still requires a viewport of at least 1600px and a left gutter of at least 280px. Responsive label spans use the existing `sm` breakpoint; localization updates each span without removing that responsive structure.

## Verification

Run the browser suites against a local server prepared without remote content hooks:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8788 pnpm exec playwright test \
  tests/search-navigation.spec.ts tests/page-index-responsive.spec.ts --workers=1
```

The search test uses a synthetic intercepted index without editing editorial content. It checks typed results, modal identity, keyboard selection, clear/close, repeated navigation and locale changes. The index test checks small/medium labels, resizing, desktop placement and locale synchronization. These tests do not establish production search indexing or search-engine ranking.
