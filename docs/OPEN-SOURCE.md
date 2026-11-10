# Open-source projects to build on

PrintForge is MIT licensed, so it can only include code from projects with compatible licences (MIT, BSD, Apache-2.0, ISC, zlib). GPL and AGPL projects are fine to learn from and to link to, but copying their code would force the whole app under the same licence.

Checked November 2026. Always read a project's LICENSE file before copying anything.

## Safe to include (permissive licences)

| Project | Licence | What it would add | Notes |
|---|---|---|---|
| [GridSpace/grid-apps](https://github.com/GridSpace/grid-apps) (Kiri:Moto, Mesh:Tool) | MIT | A real slicer in the browser (FDM, plus CNC and laser), mesh repair | The biggest win. It offers a web-worker slicing engine and an iframe messaging API, so PrintForge could send a model to it and get G-code back for the G-code preview. |
| [Manifold](https://github.com/elalish/manifold) | Apache-2.0 | Geometry engine | Already used by PrintForge. Newer versions add faster booleans, smoothing and minkowski sums. |
| [gcode-preview](https://www.npmjs.com/package/gcode-preview) | MIT | G-code rendering with tube-shaped extrusions | PrintForge has its own lighter viewer; this one draws thicker, shaded lines if you want a closer look. Uses three.js. |
| [JSCAD](https://github.com/jscad/OpenJSCAD.org) | MIT (check each package) | Readers and writers for DXF, SVG, AMF, X3D | Useful for adding DXF and SVG import to sketches. |
| [CascadeStudio](https://github.com/Irev-Dev/CascadeStudio) | MIT | Code-CAD with fillets and STEP, using OpenCascade | The app code is MIT, but the OpenCascade kernel it loads is LGPL-2.1 (see below). |
| [occt-wasm](https://github.com/andymai/occt-wasm) | Wrapper MIT/Apache-2.0, WASM build LGPL-2.1 | True fillets, chamfers, STEP import and export | About 4.5 MB. Loading the `.wasm` as a separate file from a URL (not bundling it into PrintForge's code) keeps LGPL obligations simple for a web app. |

## Learn from, but don't copy code (copyleft)

| Project | Licence | Why look at it |
|---|---|---|
| [replicad](https://npmjs.org/package/replicad) | AGPL-3.0 | Clean API for sketch, extrude, fillet and shell on OpenCascade. |
| [Chili3D](https://github.com/xiangechen/chili3d) | AGPL-3.0 | Browser B-rep CAD with sketching, fillets, STEP and IGES. |
| OrcaSlicer, Bambu Studio, PrusaSlicer, Cura | AGPL-3.0 / GPL | Feature names, colours and print-check ideas. |
| PaliCAD, QymCAD, Extrudo, SolidCraft, Forgent3D, layerling, Easy Enclosure | various | The projects PrintForge's workflows came from. |

## Image and text tools (researched November 2026)

PrintForge now has its own stencil, cookie cutter, badge, lithophane and relief makers. These projects do similar jobs and are useful references:

| Project | Licence | Notes |
|---|---|---|
| [LithoMaker](https://github.com/muldjord/lithomaker) | GPL-3.0 | Desktop lithophane maker with frame, hangers and stabilisers. Ideas only. |
| [lithophane-js](https://gh.r-mj.com/uijincho/lithophane-js) | check repo | Browser lithophane generator. |
| [hueforge-at-home](https://github.com/LucasKendi/hueforge-at-home) | check repo | Layer-colour mixing (HueForge-style filament painting) in JavaScript. A good next feature. |
| [cookie-cutter-generator](https://awesome.ecosyste.ms/projects/github.com%2Fpapooch%2Fcookie-cutter-generator) | not stated | OpenSCAD cookie cutters with a stamp of the inner image. |
| [cookie-cutter-designer](https://awesome.ecosyste.ms/projects/github.com%2Frazorglyon%2Fcookie-cutter-designer) | check repo | Svelte web cookie cutter designer. |
| [svg2stl](https://awesome.ecosyste.ms/projects/github.com%2Fmaxhalford%2Fsvg2stl) | check repo | SVG to extruded STL. |
| [awesome-3d-printing](https://www.github.com/ad-si/awesome-3d-printing) | list | Catalogue of slicers, CAD tools and online generators (QR codes, Gridfinity layouts, map terrain, LED letters, box generators). |

## Feature ideas from the research

1. **Filament painting (HueForge-style)**: a picture printed in 3–5 colours by changing filament at set layers. Builds on the relief maker plus a colour-change table for the slicer.
2. **QR code and NFC tags**: a QR encoder (MIT libraries exist, such as qrcode-generator) feeding the badge maker.
3. **Terrain and map models** from height data.
4. **Gridfinity layout planner** for whole drawers, on top of the existing bin generator.
5. **Print-in-place hinges, snap fits and threaded lids** as generators.
6. **Text along a curve and on cylinders** (mug-style labels).
7. **Hollow with drain holes** for resin prints, and **mesh repair** (Kiri:Moto's Mesh:Tool is MIT).
8. **Slicing in the browser** with Kiri:Moto (MIT), then straight to the G-code preview.

## AI services (researched November 2026)

See `AI-PLATFORMS.md`. Gemini, Claude, OpenAI-compatible services, Zoo Text-to-CAD, Tripo3D and TRELLIS (via the Gradio client, Apache-2.0, loaded from jsDelivr) are built in.

## Suggested next steps

1. **Slice inside PrintForge** with Kiri:Moto's engine (MIT): Design → Prepare → Slice → G-code preview, all in one tab.
2. **Fillets and STEP** with occt-wasm, loaded only when someone uses those tools so the app stays fast to open.
3. **DXF and SVG import** for sketches, from JSCAD's IO packages.
4. **Send to printer** over the local network (Moonraker/Klipper, OctoPrint, PrusaLink, Bambu LAN). These are protocols, so this needs new code rather than copied code.
