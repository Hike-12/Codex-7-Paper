# Tear Sheet

Tear Sheet is a browser workbench for setting type and working a sheet of paper. The desk, grain, fibers, and paper sounds are generated in the browser.

## Run locally

```sh
npm ci
npm run dev
```

```sh
npm run build
npx tsc --noEmit
```

## Controls

| Tool | Key | How to use it |
| --- | --- | --- |
| Peel | `1` | Drag a point on the sheet. An edge drag turns up a fold and exposes the sheet below it. Double-click near a corner to preview a curl. |
| Rip | `2` | Drag across the sheet. To free a piece, cut through to another cut or past an outside edge. |
| Type & stamp | `3` | Choose **Add text** and click a spot on the sheet, or click a blank spot directly. To revise existing text, click it on the sheet or choose it from **Edit text**. Pick a stamp from the tool controls, then click the sheet to apply it. |
| Crumple | `4` | Click the sheet or choose **Crumple sheet**. Grab and release the ball to throw it. **Iron out** flattens the sheet and keeps its tears. |

Open **Templates** and choose a layout to start a new sheet. The pin menu switches between top-edge pinning, unpinned Zero-G, and unpinned desk gravity. **Under-note** edits the print beneath the sheet. **Reset sheet** replaces the paper and keeps your ink. Use **Undo** or `Ctrl+Z` / `Cmd+Z` to reverse edits and gestures.

Mouse, pen, and touch all use Pointer Events. To set type without a pointer, select Type, focus the canvas, and press Enter to place an ink block at its center.

## Share and export

- **PNG** downloads a 2× rendering of the canvas. Choose the desk and under-note or a transparent export of the top sheet.
- **Share** copies a link with the paper stock, ink, under-note, pin mode, and deformed mesh. The URL fragment carries a versioned, compressed face mask and quarter-unit vertex positions. Anyone with the link can inspect the under-note.
- **Record** downloads five seconds of the canvas as WebM. Browsers need canvas stream capture and a WebM MediaRecorder codec. The capture requests up to 60 FPS and includes synthesized foley when sound is on.

## Implementation

- [PaperPhysics.ts](src/engine/PaperPhysics.ts) advances a 52 × 38 Verlet grid at fixed 60 Hz. The grid has structural and diagonal edges, with two-edge bending braces. The blade removes intersected faces and the constraints that lose face support. Connectivity to the top pins controls falling fragments.
- [PaperRenderer.ts](src/engine/PaperRenderer.ts) draws the triangle mesh in WebGL2. It projects tear fibers from exposed edges, shades the fold with face normals, and composites the paper over the drafting mat. Canvas 2D provides fallback texture mapping. [PaperTexture.ts](src/engine/PaperTexture.ts) rasterizes the ink with the grain so characters split with the mesh.
- [PaperAudio.ts](src/engine/PaperAudio.ts) filters synthesized noise for friction and fiber snaps. The stamp uses a damped oscillator and a brief noise transient.
- [exportShare.ts](src/utils/exportShare.ts) generates the PNG and WebM downloads and encodes or validates shared sheets.

The Vercel project uses the Vite preset and publishes `dist/` after `npm run build`. The app has no server functions or environment variables. The typefaces load from Google Fonts and fall back to system faces if the request fails.
