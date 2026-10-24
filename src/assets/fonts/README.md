# Social-card font outlines

Cards use the same local font families as the website, without loading host fonts:

| Resource             | Source                                              | Role                                            |
| -------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `Geist-OG.json`      | `public/fonts/Geist-Variable.woff2`, weight 400     | Descriptions                                    |
| `Geist-Bold-OG.json` | Same Geist source, weight 700                       | Identity and headings                           |
| `GeistMono-OG.json`  | `public/fonts/GeistMono-Variable.woff2`, weight 600 | Technical labels, opportunity banner and footer |

The bundled font sources carry their existing SIL Open Font License; retain
`src/assets/fonts/OFL.txt`. These JSON files are deterministic build-source
outline maps, not rendered images or browser payload. Generated PNGs stay in
ignored build output.

Regenerate the bold and mono maps offline with the repository's installed Node
and Astro dependencies:

```sh
node scripts/extract-og-fonts.mjs
```

The script retains the existing regular map's character coverage and does not
rewrite that map. Missing symbols use the regular renderer's explicit `?`
fallback rather than a different system typeface. Unicode normalization and
whole-grapheme wrapping remain in the renderer.

## Pinned decoder workaround

The maintenance script resolves `fontkitten` from Astro's installed dependency
rather than introducing a runtime font parser or new dependency. With pinned
`fontkitten` 1.0.3, `getVariation()` loses the WOFF2 decoder subclass, and its
WOFF2 glyph path bypasses variation application. The script retains the WOFF2
constructor, copies decoded default-coordinate records, then applies that
same decoder's gvar processor to points/components with phantom metrics before
serializing paths. This is an isolated offline workaround, not production
rendering logic. Fontkitten upgrades require rechecking this maintenance path;
do not silently replace real weights with stroked regular glyphs.

Tests assert the exported family/weight, distinct regular/bold outlines,
monospace advances, high-resolution output and measured banner bounds.
