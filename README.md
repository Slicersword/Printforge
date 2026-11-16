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

### Image and text tools (Image tab)
- **Stencil**: your image or text cut out of a plate, with bridges added automatically so the middles of O, A, R and so on don't fall out.
- **Cookie cutter**: a blade that follows the outline, a rim to press on, optional ridges for inner details.
- **Logo badge / keychain**: raised logo or text on a base that follows the outline, a rectangle or a circle, with a keyring loop.
- **Lithophane**: a photo that shows when light shines through it. Flat or curved, with a frame, printed standing up.
- **Relief picture**: a photo or drawing raised from a flat plate.

### Calibration prints (Code tab)
Tolerance test, overhang test, bridge test and retraction test, each with editable sizes.

### Layout

Drag the edge of the left or right panel to make it wider or narrower (double-click the edge to reset). The sizes are remembered in your browser. Move, rotate and scale handles keep the same size on screen whatever the part or window size.

- **Hide a panel** with the small tab on its edge, or `[` (library) and `]` (properties). **Focus** (`\` or the Focus button) hides both so the model fills the window.
- **Section view** (`X`): cut the view along X, Y or Z with a slider to see inside a part. Flip shows the other side. It only changes the view, not the part.
- **Right-click** a part for its actions (centre, drop, lay on face, turn, duplicate, hole, cut, texture, hide, export, delete), or empty space for view and plate actions. Shift F10 opens the same menu from the keyboard.
- **Objects list** works from the keyboard: arrows move the selection (Shift adds), Space toggles, Enter jumps to the properties, Delete removes.
- Drag a file anywhere on the window; a drop zone shows what you can open.

### LED channel corners and hexagon wall lights
- **LED strip channel**: 45° mitres now cut correctly. Choose whether mitred corners turn left or right, and add **corner joints**: L-shaped sleeves that slide over two mitred ends and hold them square.
- **Hexagon wall lights** (Parts tab): a honeycomb wall light made of LED channel bars with snap-in diffusers, joined by 2-way and 3-way connectors that screw to the wall. Choose **how many hexagons** (1–60) and how they're arranged (honeycomb cluster, two-row zig-zag wall, one row or one column), or pick a preset (one, three, seven as a flower or a wall, or a grid), and the hexagon size. Hexagons are modular: each one you add reuses the bars it shares with its neighbours. **Outside edge**: *Modular* (default) uses the same 3-way connector at every joint and closes the outward arms with blanking plugs that pull out, so you can add hexagons later; *Closed* uses 2-way corners for a fixed-size wall. The panel lists how many bars and connectors to print and how much LED strip you need. Show **One of each part** to print, then use Make many for copies.
  - **Full-frame diffuser** (Diffuser → *Full frame, one cover*): one cover over every bar and connector, fixed with double-sided tape. Ribs under the cover reach down to the bar tops, so the tape holds the bars as well as the connectors. **Piece size**: *No limit* (one piece), *Fit my build plate* (follows the printer you pick, 3 mm clear at each edge) or *Custom maximum size* or *Modular: one piece per connector* (each covers a connector and half of each bar). Cuts always go across the middle of a bar, so each joint sits on tape. **Show piece** picks one piece to export. Edge options: round the outer edge and/or the edges around each hexagon, as a fillet or a chamfer.
- **Print plate: None (no limit)** (Design page, Plate panel with nothing selected): the design area has no edges, for laying out walls or big assemblies at full size. Prepare to print, the G-code view and generators' *Fit my build plate* keep using the printer you choose there.
- **Share links**: *Share* (top bar) copies a link that opens the design, ready to edit. The whole design is inside the link (after the #), so nothing is uploaded and it works on GitHub Pages.
- **Thin walls** (toolbar): walls thinner than two nozzle widths turn purple while you design.
- **View cube** (top right): turns with the camera; click a face. Keys: 1 front, 2 back, 3 right, 4 left, 5 top, 6 bottom, 7 iso, 9 perspective/orthographic.
- **Hardware**: Bearing seat (608, 625, 688, 623, 6001, 6200; press, snug or slide fit, lead-in, stop ledge), Magnet pocket (round or block, clearance, pry slot), Snap-fit clip (warns when it would crack) and its matching Clip window.
- **G-code colours**: Feature, Speed, Flow (volumetric mm³/s) and Layer time (short, hot layers in red).
- **Background work**: booleans, fillets and the thin-wall check run in a worker, so the page never freezes.
- **Hexagon wall lights**: open-top connector hubs (strip ends and wires join inside, under the diffuser) and a snap-fit diffuser with angled joints and half-lap overlaps that reads as one piece.
- **Merge / Unmerge (Ctrl G / Ctrl Shift G)**, as in Bambu Studio: always in the selection bar, the right-click menu and the Objects header. Merge joins the selected parts into one object (holes cut into solids). Unmerge splits a merged object back into its parts, or a single mesh with separate pieces (an imported plate, a boolean result) into one object per piece.
- **Motion**: new parts print themselves into the view layer by layer, with the hot top layer glowing; menus, dialogs and messages open the same way. The camera eases between views, glides after you flick it and zooms smoothly. Turn it all off with *Animations on or off* (Ctrl K); it's also off when your system asks for reduced motion.
- **Fillet edges (E)** (toolbar, right-click menu): select a part, press E, and click the edges to round; click again to unselect. Works on straight edges, curves and circles (cylinder rims, holes), on any part including imported meshes. Fillet or 45° chamfer, any size, with a live preview. Outside edges are rounded off and inside corners filled. Quick picks: *Top edges*, *All edges*; smooth outlines (a rounded rectangle, a circle) select as one. *Apply* makes a mesh, like a boolean.
- **X-ray** (toolbar, right-click menu): shows hidden edges faintly through parts. Off by default; parts are drawn solid until you ask.

### Layer Studio, QR codes, molds and more (ideas from usestl.com)

- **Layer Studio** (Studio tab): build signs, tags and keychains layer by layer. Each layer has its own thickness and colour and holds text, icons, your own SVG or image, QR codes, rectangles, circles and polygons, an outline that follows everything above it, keyring loops that stick to the edge, and holes through every layer. Where layers overlap they interlock: the upper layer sinks into a pocket in the one below, so colours sit flush. Each layer is its own object, so a 3MF keeps the colours. Presets: QR code sign, Wi-Fi QR sign, QR keychain, name keychain, letter keychain, icon tag and door sign. Double-click a layer on the plate to edit the design again.
- **QR codes**: links, text, Wi-Fi login, contact cards, email, phone and text messages, with error correction L/M/Q/H. The encoder is built in (no internet needed) and shows the module size so you know it will print.
- **LED strip channel**: sized to your strip, with a snap-in diffuser (a cover with two flexible legs whose barbs click into grooves in the walls), end caps (plain or with a cable exit), 45° mitres for corners, M3 mounting holes and joiners for runs longer than your bed. The channel, diffuser, caps and joiner are separate linked objects: change a setting on one and the others follow, and each keeps its own colour.
- **Mold generator** (select a part, then Studio tab → Tools or Ctrl K): a two-part rigid mold split at the widest point with alignment pins, pour spout, air vents and clamp ears; a silicone mold box (optionally split in two); or a multi-cavity tray for ice, chocolate or soap.
- **Gridfinity baseplate for a drawer**: type the drawer size; you get as many 42 mm cells as fit, padding to fill the drawer, optional magnet holes, split into pieces that fit your bed.
- **Cost calculator**: filament, electricity, printer wear and upkeep, your time, extras, failed prints and profit margin, with the weight and time filled in from Prepare to print.
- **Vase waves**: the vase generator can now ripple up the side as well as twist.

### Models tab (more ideas from usestl.com)

- **Lithophane letter**: a big hollow initial with a removable lithophane panel in the front (choose any photo), room for an LED strip, a cable slot in the base and a script name across the front. Body, panel and name are linked parts in three colours.
- **Screw-lock carabiner**: body with a threaded nose, a gate on a pin, a knurled sleeve that screws over the nose, and a name on the side. Light duty, never for climbing.
- **Folding box**: a mailer box printed flat in one piece with thin creases, corner tabs, dust flaps and a tuck-in lid. Optional picture on the lid, engraved or in a second colour.
- **Geometric planter**: diamond facets, a polygonal rim, a drainage hole and an optional saucer.
- **Vent grille**: rectangular, square, round or hexagonal, 45° louvers that print without supports, countersunk screw holes.
- **Texture an STL** (Ctrl K or Studio tab → Tools): 26 relief patterns (honeycomb, knurl, diamond plate, bricks, stone, leather, wood, weave, carbon twill, scales, hearts, stars…) or your own image tile. Pattern size, depth, rotation, engrave, symmetric relief and overhang protection; box, cylinder or top-down projection; the base stays flat and you can click faces to keep them smooth. Live preview, then Apply.
- **Make many at once**: select a model with a name and type a list of names; you get one complete copy (all linked parts) per name.
- Script and display fonts for names: Pacifico, Great Vibes, Lobster, Bebas Neue, Anton and Righteous (Google Fonts, SIL Open Font Licence).

### Templates tab (in the spirit of ParamaCraft Lite)

Pick an everyday object and shape it with sliders: **divided tray**, **box with a press-fit or sliding lid** (two parts), **spacer / washer** (round, hex or square, any quantity), **phone or tablet stand**, **slotted drawer dividers**, **test tube rack**, **snap-in cable guide** and **hose / pipe adapter** with barbs. Every number setting in the right panel now has a slider as well as a typed value.

### Lithophane folding fan

Fan blades that show a picture when light shines through: one picture across the whole fan, or one picture per group of blades, plus optional text in any font. A built-in sunset picture is used until you choose your own. Blades print flat; join them through the pivot holes with an M3 screw or a rivet.

### Texture tool, more options

Unfolded projection (the pattern runs on around the sides), 33 patterns, smooth-face masks (paint a face, bucket by angle, erase), orientation (place on face, rotate X/Y/Z), choose an STL / 3MF from inside the tool, a 50 mm demo cube when nothing is selected, shell and open-edge counts, and settings you can save and open again.

### G-code preview
- Open a `.gcode` file from Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Kiri:Moto or any other slicer, or a Bambu `.gcode.3mf`. Drop it on the view or use **Import**.
- Toolpaths coloured by feature (outer and inner walls, infill, top and bottom, bridges, support, skirt and brim) or by speed. Turn any feature off.
- Layer slider, a moves slider inside a layer, **This layer only**, travel moves, and **Play** to watch the nozzle.
- Layers, height, print time and filament from the slicer's notes in the file, with a warning when the file is bigger than your plate.
- A tall layer slider on the left of the view (current layer and height) and the moves slider along the bottom, like a slicer.
- Large files load in steps: the first layers show while the rest is still being read.
- **Send to printer…** uploads the open G-code to **OctoPrint** or **Klipper (Moonraker, Mainsail, Fluidd)**, and can start the print after you confirm. Your browser blocks an https page (such as GitHub Pages) from talking to a printer on plain http, so from the hosted site use **Download and open printer page**, or run PrintForge from your own computer (http://localhost) to send directly. OctoPrint needs CORS turned on; Moonraker needs this site in `cors_domains`. The API key is kept for the current tab only unless you tick Remember.

### Look and feel
- **Appearance** menu (half-circle button): theme follows your system, or choose Light or Dark; six accent colours; Studio grey (like Bambu Studio, the default), textured, smooth black or cool build plate. Your choice is remembered.
- **Search tools** (Ctrl K): find any shape, generator, example, command, view or setting by typing part of its name.
- A start panel on an empty plate with one-click starting points.

### Files
- Export **3MF** (separate parts with colours; opens in Bambu Studio, OrcaSlicer, PrusaSlicer, Cura), **STL**, **OBJ + MTL**, the selection only, or every part as its own STL in a zip.
- Import **STL** (binary or text), **OBJ** and **3MF**, and open **G-code** for preview. Imported meshes can be cut, grouped with holes and so on.
- Save and open projects as `.pforge` files.
- **Autosave**: your design is saved in the browser (IndexedDB) as you work. The label next to the name shows Saving…, Saved in this browser, or Save failed with a **Download backup** button. PrintForge also keeps the last 6 versions (every few minutes, and before New or Open); open **Recover** from Help or search to go back to one.
- Opening a damaged project file shows what is wrong and leaves your current design untouched.
- **Works offline** and can be installed as an app (Help → Install as app, where the browser supports it).

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
| Search every tool | Ctrl K (⌘K on Mac) |
| Section view / focus / hide library / hide properties | X / \\ / [ / ] |
| Actions menu | right-click, or Shift F10 |
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
js/repair.js            rebuilds leaky meshes as watertight solids
js/tools.js             tool bar, mesh boolean, lay on face, panels, section view, right-click menu
js/storage.js           autosave and recovery versions (IndexedDB)
js/printlink.js         send to OctoPrint / Moonraker
js/qr.js                QR code encoder
js/studio.js            Layer Studio (layers, QR, icons, keychains)
js/mold.js              mold generator and cost calculator
js/models.js            lithophane letter, carabiner, folding box, planter, vent grille, make many
js/texture.js           Texture an STL (displacement textures)
js/templates.js         ParamaCraft-style templates with sliders
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
- Send to printer was written against the OctoPrint and Moonraker documentation but hasn't been tested on a real printer yet.
- PrintForge doesn't slice yet. Use your slicer, then check the result in G-code preview.
- Text uses the fonts on the device you're using. Use **Freeze as mesh** to keep text identical across computers.

## Licence

MIT, see `LICENSE`. The Manifold library in `vendor/` is Apache-2.0, see `vendor/LICENSE-manifold.txt`.
