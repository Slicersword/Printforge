# PrintForge

Design parts for 3D printing in your browser. Put shapes on the plate, cut holes, draw sketches, generate enclosures, gears and threads, write parametric code models, check and orient everything for printing, export a 3MF for your slicer, then open the sliced G-code to check it layer by layer.

No account, no install, no build step. It is plain HTML, CSS and JavaScript plus the Manifold geometry engine (WebAssembly), so it runs from GitHub Pages or any static web host, and keeps working offline once loaded.

**Live app:** `https://<your-user>.github.io/<this-repo>/` (after the one-time setup below)

## Put it online with GitHub Pages

1. Create a new repository on GitHub and upload everything in this folder to it, keeping the folder structure (the `.github` folder too).
2. In the repository, open **Settings → Pages**, and under **Build and deployment → Source** choose **GitHub Actions**.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow from the **Actions** tab). After a minute the app is at `https://<your-user>.github.io/<repo>/`.

Prefer not to use Actions? Choose **Deploy from a branch → main → / (root)** instead. The `.nojekyll` file is already there so every file is served as-is.

### Run it on your own computer

The app loads JavaScript modules and WebAssembly, so it must be served over HTTP. Opening `index.html` straight from disk won't work.

```sh
cd printforge
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, nginx, Caddy, IIS).

## What it does

### Design
- **Shapes**: box (with rounded edges), cylinder (with top chamfer), sphere, half sphere, cone, tube, torus, wedge, pyramid, polygon, star, heart, slot, and **text** in any installed font.
- **Holes and hardware**: screw holes M2–M8 with counterbore or countersink, nut traps, heat-set insert holes, teardrop holes that print without supports, and vent grids (round, hex, square, slot).
- **Solids and holes**: turn any shape into a hole, select it with a solid, and **Group** to cut. Ungroup to edit again.
- **Move, Rotate, Scale and Lay on face** (as in Bambu Studio): pick a tool from the bar at the top-left of the view or press `M`, `R`, `S` or `F`.
  - **Move**: drag a coloured arrow (red X, green Y, blue Z), or drag the part across the plate. Snaps to the grid; Shift snaps to 10 mm; Ctrl moves freely.
  - **Rotate**: drag a coloured ring to turn around that axis, about the centre of the selection. Whole degrees; Shift snaps to 15°. Parts on the plate stay on the plate.
  - **Scale**: drag a coloured cube to stretch that direction (both sides), Ctrl+drag to stretch one side only, or drag the white corner cube to scale evenly. Shift snaps to whole millimetres.
  - **Lay on face**: hover a flat face (it lights up orange) and click to put it on the plate.
  - **Exact numbers** in the panel on the right: position, size in mm, scale in %, rotation in degrees, Keep proportions, ×0.5 / ×2, quick 90° turns, Reset rotation and scale, Mirror X/Y/Z. With several parts selected you can move, turn and scale them together. Number fields accept sums such as `40/2+3` or `1.5*inch`.
- **Mesh boolean** (`B`), modelled on Bambu Studio's Mesh Boolean tool and PaliCAD's union / subtract / intersect: select parts (shapes or imported STL/OBJ/3MF meshes), pick **Union**, **Subtract** or **Intersect**, mark each part **Keep** or **Cut away**, and check the live preview with its volume and piece count before you **Apply**. You can keep the originals (hidden). Grouping holes instead keeps the shapes editable.
- **Cut in two** (`C`) along X, Y or Z.
- **Measure** the distance between any two points.

### Generators
Electronics enclosure (lip or screw lid, PCB standoffs, USB-C/Micro-USB/DC-jack cut-outs, vents), spur gear (straight, helical or herringbone involute teeth), Gridfinity-style bin, bolt and nut with real helical threads, vase for spiral/vase mode, knob with D-shaft, cable clip, and name tag/keyring. Every value stays editable afterwards.

### Sketch
Draw rectangles, circles, polygons, slots and outlines on a grid, typing exact sizes. Shapes inside other shapes become holes. Repeat a shape in a grid or a circle, mirror it, then **extrude** (with taper and twist) or **revolve**. Double-click a sketch on the plate to edit it again. **Trace an image or logo** (PNG, JPG, SVG) to turn it into a solid.

### Code
Write a model in JavaScript. Values declared with `params()` become controls in the panel:

```js
const p = params({ width: [40, 10, 200], holes: [4, 1, 12], rounded: true });
const plate = box(p.width, 30, 4, p.rounded ? 3 : 0);
const holes = repeat(p.holes, (i) => cyl(3.4, 10).translate([-p.width / 2 + 6 + i * 8, 0, -1]));
return subtract(plate, holes);
```

Helpers: `box`, `cyl`, `cone`, `ball`, `gear`, `thread`, `rect`, `circle`, `poly`, `extrude`, `revolve`, `union`, `subtract`, `intersect`, `hull`, `repeat`, and the whole Manifold API (`Manifold`, `CrossSection`). `sin`, `cos` and `tan` take degrees. Examples are included (wall hook, phone stand, honeycomb coaster, planter, gear pair).

### Prepare to print
- 28 printer presets (Bambu Lab, Prusa, Creality, Elegoo, Anycubic, Qidi, Voron, Snapmaker, Flashforge) plus a custom size. The plate in the view is drawn at the real size.
- **Print check**: fits the build volume, sits on the plate, first-layer contact, overhang area, walls thinner than one line, tall and narrow parts, holes left ungrouped.
- **Lay flat** (largest flat face down), **Auto-orient** (fewest overhangs), **Auto-arrange** (packs the plate).
- **Overhang view** in red, with an adjustable angle, and a **layer slider** that cuts the model at any layer.
- **Estimates**: weight, filament length, time and cost for PLA, PETG, ABS, ASA, TPU, nylon or PC, with your layer height, walls and infill.

### Make it with AI
Click **AI** and pick a platform. Each one keeps its own key in your browser, so switching platforms picks up the right key. Full details, free tiers and the optional relay: `docs/AI-PLATFORMS.md`.

| Platform | Gives you | From |
|---|---|---|
| Gemini (Google AI Studio, free tier) | An editable code model | Text |
| Claude (Anthropic API) | An editable code model | Text |
| OpenAI-compatible (OpenAI, OpenRouter, Groq, Ollama, LM Studio) | An editable code model | Text |
| Zoo Text-to-CAD | A CAD mesh | Text |
| Tripo3D | A detailed mesh | Text or a picture |
| TRELLIS on Hugging Face (free GPU) | A mesh | A picture |

- Code models come with their main sizes as controls in the panel. If the AI's code fails, the error goes back to it to fix, up to twice. Select one and use **Change with AI** to ask for changes.
- Meshes are scaled to the size you choose. Leaky meshes are rebuilt as watertight solids automatically.
- GLB files can now be imported too.

### Image and text tools (Image tab)
- **Stencil**: your image or text cut out of a plate, with bridges added automatically so the middles of O, A, R and so on don't fall out.
- **Cookie cutter**: a blade that follows the outline, a rim to press on, optional ridges for inner details.
- **Logo badge / keychain**: raised logo or text on a base that follows the outline, a rectangle or a circle, with a keyring loop.
- **Lithophane**: a photo that shows when light shines through it. Flat or curved, with a frame, printed standing up.
- **Relief picture**: a photo or drawing raised from a flat plate.

### Calibration prints (Code tab)
Tolerance test, overhang test, bridge test and retraction test, each with editable sizes.

### G-code preview
- Open a `.gcode` file from Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Kiri:Moto or any other slicer, or a Bambu `.gcode.3mf`. Drop it on the view or use **Import**.
- Toolpaths coloured by feature (outer and inner walls, infill, top and bottom, bridges, support, skirt and brim) or by speed. Turn any feature off.
- Layer slider, a moves slider inside a layer, **This layer only**, travel moves, and **Play** to watch the nozzle.
- Layers, height, print time and filament from the slicer's notes in the file, with a warning when the file is bigger than your plate.

### Look and feel
- **Appearance** menu (half-circle button): theme follows your system, or choose Light or Dark; six accent colours; Studio grey (like Bambu Studio, the default), textured, smooth black or cool build plate. Your choice is remembered.
- **Search tools** (Ctrl K): find any shape, generator, example, command, view or setting by typing part of its name.
- A start panel on an empty plate with one-click starting points.

### Files
- Export **3MF** (separate parts with colours; opens in Bambu Studio, OrcaSlicer, PrusaSlicer, Cura), **STL**, **OBJ + MTL**, the selection only, or every part as its own STL in a zip.
- Import **STL** (binary or text), **OBJ** and **3MF**, and open **G-code** for preview. Imported meshes can be cut, grouped with holes and so on.
- Save and open projects as `.pforge` files. Your current design is also autosaved in the browser.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Orbit / pan / zoom | left-drag empty space or right-drag / middle-drag / scroll |
| Move / Rotate / Scale / Lay on face | M / R / S / F |
| Cut / Mesh boolean / Measure | C / B / U |
| Hole ↔ solid | H |
| Group / ungroup | Ctrl G / Ctrl Shift G |
| Duplicate | Ctrl D, or Alt-drag |
| Turn 90° / drop to plate | Shift R / D |
| Nudge / raise | arrows / Page Up, Page Down (Shift ×10) |
| Undo / redo | Ctrl Z / Ctrl Shift Z |
| Search every tool | Ctrl K |
| Views | 7 top, 1 front, 3 right, 0 iso, 5 perspective/orthographic, Z fit |
| Save / open / export STL | Ctrl S / Ctrl O / Ctrl E |

## Project layout

```
index.html              page shell
css/app.css             styles (light and dark)
js/main.js              app controller, commands, shortcuts, files
js/kernel.js            Manifold wrapper, geometry cache, render meshes
js/scene.js             document model, groups, undo history, project files
js/renderer.js          WebGL2 renderer (plate, meshes, holes, overhangs, layer cut)
js/viewport.js          picking, dragging, camera, measuring
js/ui.js                panels and inspector
js/shapes.js            shape library and print hardware
js/generators.js        enclosure, gear, Gridfinity, threads, vase, knob, clip, tag
js/sketch.js            sketch editor, extrude and revolve
js/textshape.js         text and image tracing
js/script.js            code models
js/printprep.js         print checks, orientation, arrangement, estimates
js/gcode.js             G-code reader and layer preview
js/palette.js           Ctrl K command search
js/makers.js            stencil, cookie cutter, badge, lithophane, relief
js/ai.js                AI platforms (Gemini, Claude, OpenAI-compatible, Zoo, Tripo3D, TRELLIS)
js/repair.js            rebuilds leaky meshes as watertight solids
js/tools.js             tool bar, mesh boolean tool, lay on face
relay/worker.js         optional Cloudflare relay for Zoo and Tripo3D
js/io.js                STL, OBJ, 3MF and ZIP read/write
js/printers.js          printer and material presets
vendor/                 Manifold (Apache-2.0)
sw.js                   offline cache
```

To add a shape, call `defineShape(kind, { label, category, params, build })` in `js/shapes.js`; the library button, inspector controls, undo and export come for free. `build` receives the parameter values and the Manifold API and returns a solid.

## Where the ideas come from

PrintForge is new code. It brings together workflows from these open-source projects:

- **layerling** and **Tinkercad**-style editing: shapes and holes, grouping, hole patterns, printer presets, overhang and print estimates
- **Easy Enclosure**: the parametric electronics enclosure
- **PaliCAD**, **Extrudo**, **QymCAD** and **SolidCraft**: sketch → extrude/revolve modelling with exact dimensions; the mounting-plate example follows the PaliCAD getting-started guide
- **Forgent3D**: models written as code with editable parameters
- **Bambu Studio**: plate, auto-arrange, lay flat, auto-orient, overhang view and layer preview

No source code was copied from those projects; several of them are AGPL or GPL licensed. Printer build volumes are public manufacturer specifications.

See `docs/OPEN-SOURCE.md` for open-source projects worth building on next, with their licences.

## Limits

- Geometry is mesh-based (Manifold), not a B-rep kernel, so STEP export and true edge fillets aren't available. Rounded boxes, chamfered cylinders and the generators cover common cases.
- Estimates are approximate; your slicer gives the real numbers.
- PrintForge doesn't slice yet. Use your slicer, then check the result in G-code preview.
- Text uses the fonts on the device you're using. Use **Freeze as mesh** to keep text identical across computers.

## Licence

MIT, see `LICENSE`. The Manifold library in `vendor/` is Apache-2.0, see `vendor/LICENSE-manifold.txt`.
