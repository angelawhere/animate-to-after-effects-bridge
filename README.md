# Animate to After Effects Pipeline

A two-script pipeline for exporting hand-drawn animation from Adobe Animate into After Effects, preserving keyframe timing, symbol playback, and layer structure.

---

## Scripts

- **`animate_export.jsfl`** – run inside Adobe Animate. Exports PNG sequences and a scene JSON for all visible layers and symbols.
- **`ae_import.jsx`** – run inside Adobe After Effects. Reads the exported data and builds symbol comps and a master comp with Time Remap.
- **`render_queue.jsfl`** – optional. Batch exports multiple FLA files using `animate_export.jsfl`.

---

## Requirements

- Adobe Animate (any version with JSFL support)
- Adobe After Effects

---

## Installation

Place all scripts in the same folder. Run them via:
- Animate: **Commands > Run Command**
- After Effects: **File > Scripts > Run Script File**

---

## How to Use

### Step 1: Export from Animate (`animate_export.jsfl`)

Open your scene, make sure you're on the main timeline and not inside a symbol, run the script and select an output folder when prompted. On first run, the script creates a folder named after the FLA, then a version folder inside it. Each subsequent run adds a new version, so nothing is ever overwritten.

```
(output folder)          ← your pick
└── c114_col04/          ← scene folder
    └── v001/            ← version folder
        ├── Amy/
        │   └── Amy_001.png, Amy_002.png, Amy_003.png…
        ├── Amy_righthand/
        │   └── Amy_righthand_001.png, Amy_righthand_002.png…
        ├── Dad/
        │   └── Dad_001.png, Dad_002.png, Dad_003.png…
        ├── Dad_box/
        │   └── Dad_box_001.png, Dad_box_002.png…
		├── symbols/     ← unique symbols exported once each
        │   └── dad_walk/
        │       └── box/
        │           └── dad_walk_box_001.png, dad_walk_box_002.png…
        │       └── dad/
        │           └── dad_walk_dad_001.png, dad_walk_dad_002.png…
		└── c114_col04.json
```

### Step 2: Import into After Effects (`ae_import.jsx`)

Run the script inside After Effects and select the FLA output folder (e.g. `c114_col04/`). The script finds the latest version, reads the scene JSON, builds one comp per unique symbol, and assembles a master comp. Re-running creates new comps and folders with versioned names `(2)`, `(3)` etc.

---

## Config Options

Edit at the top of `animate_export.jsfl`:

```javascript
var TEST_MODE = false;
// Set to true for a dry run – logs what would be exported without writing files

var USE_DEFAULT_FOLDER = false;
var DEFAULT_FOLDER = "C:/users/you/documents/project/output/";
// Set USE_DEFAULT_FOLDER to true to skip the folder picker every run
```

---

## Project Panel Structure in After Effects

```
c114_col04_v001/
  Amy (footage)          ← drawn layer footage
  Amy_righthand (footage)
  Dad (footage)
  Dad_box (footage)
  dad_walk/              ← symbol footage folder
    dad_walk_box         ← one footage item per symbol layer
    dad_walk_dad
  dad_walk (comp)        ← symbol comp
c114_col04_v001 (comp)   ← master comp
```

Symbol comps and their footage folders share the same name for easy matching.

---

## What Gets Exported

- Only visible normal layers are exported; guide, mask, and invisible layers are skipped
- Each Animate layer becomes one footage sequence, but may split into multiple AE layers if it mixes drawn frames and symbols, or has blank gaps.
- Animate keyframes become Time Remap hold keys in AE
- Symbols get their own comps and are labelled cyan in the master comp.

---

## Symbol Handling

Each unique symbol is exported once as a shared comp. Multiple instances across layers and frames all reference the same comp, each with their own transform and Time Remap in the master comp.

Symbol comps preserve all internal layers, each with their own footage sequence and Time Remap reflecting the symbol's keyframe structure.

### Supported

- **Loop** – full symbol exported, `loopOut()` applied per instance
- **Play once** – full symbol exported, plays through once
- **Single frame** – exported as a still at the set frame
- **First and last frame** – set the playback range. When only first frame is set, playback starts from there – for loops, the full symbol still cycles; for play once, it plays from that frame to the end. When both are set, only that range plays.
- **Multiple symbols on the same frame** – each exported and placed as a separate AE layer
- **Mixed frame (drawing + symbol)** – symbols exported, drawing ignored with a warning
- **Symbol with multiple layers** – all layers preserved in the symbol comp
- **Position, rotation, scale** – applied per instance in the master comp
- **Skew** – equal skewX/Y is translated as rotation. Uneven skew is approximated; opposite-sign skew unsupported

### Unsupported

- **Reverse loop / reverse play once** – falls back to forward playback, warning issued
- **Nested symbols** – the outer symbol is entered and exported normally; the nested symbol is treated as a still at its current position, warning issued
- **Opposite-sign skewX/Y** – ignored, warning issued

---

## Render Queue

For batch overnight exports, edit `FLA_LIST` in `render_queue.jsfl` and run it. Keep it in the same folder as `animate_export.jsfl`. The script exports each scene in order, closing each file when done.

If `USE_DEFAULT_FOLDER` is set in `animate_export.jsfl`, that folder is used automatically. Otherwise you're prompted once and the location is remembered for next time.

```javascript
var FLA_LIST = [
    "C:/users/you/documents/project/c114_col04.fla",
    "C:/users/you/documents/project/c114_col05.fla",
    "C:/users/you/documents/project/c114_col06.fla",
];
```

---

## Versioning and Re-imports

Each export creates a new version folder (`v001`, `v002`…). Each import creates a new footage folder and master comp (`(2)`, `(3)`...), so if you re-export specific layers and re-import, you'll get a second comp rather than updating the first. Copy updated layers across manually if needed. 

---

## Warnings

Warnings are printed to Animate's Output panel at the end of each export:

- **Reverse loop / reverse play once** – falls back to forward
- **Nested symbol** – treated as a still frame
- **Mixed frame** – drawing ignored, symbols exported
- **Opposite-sign skew** – ignored
- **Uneven skew** – approximated
- **First > last frame** – last frame treated as unset

---

## Troubleshooting

**Wrong frame rate in AE** – the script conforms footage to the FLA's frame rate. If keys look offset, check that both the AE project frame rate and the imported footage frame rate match the FLA.

**Path errors on import** – make sure the output folder hasn't been moved or renamed since export. The JSON stores absolute paths. Also check you're selecting the right folder: the export script asks for an output root, while the import script asks for the scene folder inside it (e.g. output/c114_col04/, not output/).

**Script runs from inside a symbol** – always export from the main timeline. Make sure you're not inside a symbol edit mode before running.

**Re-import creates duplicate comps** – expected behaviour. Each import run creates new items labelled `(2)`, `(3)` etc. Copy layers from the new comp into your working comp as needed.
