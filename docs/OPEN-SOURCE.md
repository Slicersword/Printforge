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

## Suggested next steps

1. **Slice inside PrintForge** with Kiri:Moto's engine (MIT): Design → Prepare → Slice → G-code preview, all in one tab.
2. **Fillets and STEP** with occt-wasm, loaded only when someone uses those tools so the app stays fast to open.
3. **DXF and SVG import** for sketches, from JSCAD's IO packages.
4. **Send to printer** over the local network (Moonraker/Klipper, OctoPrint, PrusaLink, Bambu LAN). These are protocols, so this needs new code rather than copied code.
