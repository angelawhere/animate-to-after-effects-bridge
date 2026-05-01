// ============================================================
// animate_export.jsfl
// Exports keyframe timing and PNG sequences from Adobe Animate
// for import into After Effects via ae_import.jsx.
//
// Exports one PNG per keyframe per visible layer (drawn and
// symbol layers), and one scene JSON with all timing data.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
var TEST_MODE = false;
// Set true for a dry run – logs what would be exported without writing files

var USE_DEFAULT_FOLDER = false;
var DEFAULT_FOLDER = "C:/users/you/documents/project/output/";
// Set USE_DEFAULT_FOLDER to true and fill in DEFAULT_FOLDER
// to skip the folder picker every run

// ============================================================
// MAIN
// ============================================================
function main(docPath, outputFolder) {
    if (docPath) {
        fl.openDocument(FLfile.platformPathToURI(docPath));
    }

    var doc = fl.getDocumentDOM();
    if (!doc) { log("ERROR: No document open."); return; }

    // Exit any symbol edit modes back to main timeline
    while (doc.getTimeline() !== doc.getTimeline(0)) {
        doc.exitEditMode();
    }

    // Resolve output folder
    var folderURI;
    if (outputFolder) {
        folderURI = FLfile.platformPathToURI(outputFolder);
    } else if (USE_DEFAULT_FOLDER && DEFAULT_FOLDER) {
        folderURI = FLfile.platformPathToURI(DEFAULT_FOLDER);
        log("Using default folder: " + DEFAULT_FOLDER);
    } else {
        var lastFolder = "";
        try { lastFolder = fl.getPrefString("AnimateExport", "lastFolder", ""); } catch(e) {}
        folderURI = fl.browseForFolderURL("Select output folder", lastFolder);
        if (!folderURI) { log("Cancelled."); return; }
        try { fl.setPrefString("AnimateExport", "lastFolder", folderURI); } catch(e) {}
    }

    var OUTPUT_FOLDER = FLfile.uriToPlatformPath(folderURI).split("\\").join("/") + "/";
    var fps = doc.frameRate;
    var flaName = doc.name.replace(".fla", "");
    var timeline = doc.getTimeline();
    var layers = timeline.layers;

    var versionFolder = getVersionFolder(OUTPUT_FOLDER + flaName + "/");

    log("=== animate_export.jsfl ===");
    log("Scene: " + flaName + "  FPS: " + fps + "  Test mode: " + TEST_MODE);
    log("Output: " + versionFolder);

    if (!TEST_MODE) {
        FLfile.createFolder(FLfile.platformPathToURI(versionFolder));
    }

    // Store original layer visibility
    var originalVisibility = [];
    for (var i = 0; i < layers.length; i++) {
        originalVisibility.push(layers[i].visible);
    }

    // --------------------------------------------------------
    // FIRST PASS – collect unique symbols from visible layers
    // --------------------------------------------------------
    var symbolMap = {};
    var warnings = [];

    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (!originalVisibility[i] || layer.layerType !== "normal") continue;

        var frames = layer.frames;
        var f = 0;
        while (f < frames.length) {
            var frame = frames[f];
            if (frame.startFrame !== f) { f++; continue; }
            if (frame.isEmpty) { f += frame.duration; continue; }

            var ft = getFrameType(frame);
            if (ft === "symbol" || ft === "mixed") {
                for (var e = 0; e < frame.elements.length; e++) {
                    var ele = frame.elements[e];
                    if (ele.elementType === "instance" && ele.instanceType === "symbol") {
                        var safeSymName = sanitiseName(ele.libraryItem.name);
                        if (!symbolMap[safeSymName]) {
                            symbolMap[safeSymName] = { originalName: ele.libraryItem.name, safeSymName: safeSymName };
                        }
                    }
                }
            }
            f += frame.duration;
        }
    }

    // --------------------------------------------------------
    // EXPORT SYMBOLS
    // --------------------------------------------------------
    var symbolsData = {};
    for (var safeSymName in symbolMap) {
        var symInfo = symbolMap[safeSymName];
        var symData = exportSymbol(doc, symInfo.originalName, safeSymName, versionFolder, fps, warnings);
        if (symData) symbolsData[safeSymName] = symData;
    }

    // --------------------------------------------------------
    // SECOND PASS – export drawn layers, record symbol instances
    // --------------------------------------------------------
    var layersData = [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (!originalVisibility[i] || layer.layerType !== "normal") continue;

        var layerData = exportLayer(doc, timeline, layer, i, versionFolder, fps, warnings);
        if (layerData) layersData.push(layerData);
    }

    // Restore layer visibility
    for (var i = 0; i < layers.length; i++) {
        layers[i].visible = originalVisibility[i];
    }

    // --------------------------------------------------------
    // WRITE SCENE JSON
    // --------------------------------------------------------
    var sceneData = {
        flaName: flaName,
        fps: fps,
        totalFrames: timeline.frameCount,
        width: doc.width,
        height: doc.height,
        symbols: symbolsData,
        layers: layersData
    };

    if (!TEST_MODE) {
        FLfile.write(
            FLfile.platformPathToURI(versionFolder + flaName + ".json"),
            toJSON(sceneData, 1),
            "overwrite"
        );
    }

    log("=== Export complete: " + layersData.length + " layer(s), " + Object.keys(symbolsData).length + " symbol(s) ===");

    // Print warnings organised by layer
    var totalWarnings = 0;
    for (var i = 0; i < layersData.length; i++) {
        var ld = layersData[i];
        if (ld.warnings && ld.warnings.length > 0) {
            if (totalWarnings === 0) log("\n=== WARNINGS ===");
            log("Layer: " + ld.name);
            for (var w = 0; w < ld.warnings.length; w++) log("  ! " + ld.warnings[w]);
            totalWarnings += ld.warnings.length;
        }
    }
    if (warnings.length > 0) {
        if (totalWarnings === 0) log("\n=== WARNINGS ===");
        for (var w = 0; w < warnings.length; w++) log("  ! " + warnings[w]);
        totalWarnings += warnings.length;
    }
    if (totalWarnings === 0) log("No warnings.");
}

// ============================================================
// EXPORT SYMBOL
// Enter symbol, get bounding box, export each layer separately.
// Content is shifted to stage center during export to avoid
// clipping, then compensated in AE via compAnchorX/Y.
// ============================================================
function exportSymbol(doc, originalName, safeSymName, versionFolder, fps, warnings) {
    var symFolder = versionFolder + "symbols/" + safeSymName + "/";

    if (!TEST_MODE) {
        FLfile.createFolder(FLfile.platformPathToURI(versionFolder + "symbols/"));
        FLfile.createFolder(FLfile.platformPathToURI(symFolder));
    }

    doc.library.editItem(originalName);
    var symTimeline = doc.getTimeline();
    var symLayers = symTimeline.layers;
    var totalSymFrames = symTimeline.frameCount;

    // Get bounding box of all symbol content
    doc.selectAll();
    var bounds = doc.getSelectionRect();
    doc.selectNone();

    var symWidth  = Math.round(bounds.right - bounds.left);
    var symHeight = Math.round(bounds.bottom - bounds.top);
    var anchorX   = Math.round(-bounds.left);
    var anchorY   = Math.round(-bounds.top);

    // Offset to move bounding box center to stage center during export
    var boxCenterX   = bounds.left + (bounds.right - bounds.left) / 2;
    var boxCenterY   = bounds.top  + (bounds.bottom - bounds.top) / 2;
    var exportOffsetX = doc.width  / 2 - boxCenterX;
    var exportOffsetY = doc.height / 2 - boxCenterY;

    // Anchor in the symbol comp = where registration point (0,0) lands after shift
    var compAnchorX = exportOffsetX;
    var compAnchorY = exportOffsetY;

    // Store original layer visibility
    var originalVisibility = [];
    for (var i = 0; i < symLayers.length; i++) {
        originalVisibility.push(symLayers[i].visible);
    }

    var symLayersData = [];

    for (var i = 0; i < symLayers.length; i++) {
        var layer = symLayers[i];
        if (!originalVisibility[i] || layer.layerType !== "normal") continue;

        var layerName   = sanitiseName(layer.name);
        var layerFolder = symFolder + layerName + "/";

        if (!TEST_MODE) {
            FLfile.createFolder(FLfile.platformPathToURI(layerFolder));
        }

        // Show only this layer
        for (var j = 0; j < symLayers.length; j++) {
            symLayers[j].visible = (j === i);
        }

        var frames = layer.frames;
        var keyframeData = [];
        var pngCounter = 1;
        var f = 0;

        while (f < frames.length) {
            var frame = frames[f];
            if (frame.startFrame !== f) { f++; continue; }
            if (frame.isEmpty) { f += frame.duration; continue; }

            var ele = frame.elements[0];
            if (ele && ele.elementType === "instance" && ele.instanceType === "symbol") {
                warnings.push("Nested symbol '" + ele.libraryItem.name + "' inside '" + originalName + "' – treated as a still frame.");
            }

            var pngName = safeSymName + "_" + layerName + "_" + padNum(pngCounter, 3) + ".png";

            if (!TEST_MODE) {
                symTimeline.currentFrame = f;
                doc.selectAll();
                doc.moveSelectionBy({ x: exportOffsetX, y: exportOffsetY });
                try {
                    doc.exportPNG(FLfile.platformPathToURI(layerFolder + pngName), true, true);
                } catch(e) {
                    warnings.push("Symbol '" + originalName + "' layer '" + layer.name + "' frame " + f + ": export failed – " + e.toString());
                }
                doc.selectAll();
                doc.moveSelectionBy({ x: -exportOffsetX, y: -exportOffsetY });
                doc.selectNone();
            }

            keyframeData.push({ frame: f, duration: frame.duration, png: pngName });
            pngCounter++;
            f += frame.duration;
        }

        symLayersData.push({ name: layerName, folder: layerFolder, keyframes: keyframeData });
    }

    // Restore layer visibility
    for (var i = 0; i < symLayers.length; i++) {
        symLayers[i].visible = originalVisibility[i];
    }

    doc.exitEditMode();

    return {
        originalName: originalName,
        folder: symFolder,
        width: symWidth,
        height: symHeight,
        anchorX: anchorX,
        anchorY: anchorY,
        compAnchorX: compAnchorX,
        compAnchorY: compAnchorY,
        exportOffsetX: exportOffsetX,
        exportOffsetY: exportOffsetY,
        totalFrames: totalSymFrames,
        layers: symLayersData
    };
}

// ============================================================
// EXPORT LAYER
// Drawn frames: export PNGs from main timeline.
// Symbol frames: record instance data (no PNG export).
// A layer may produce multiple aeLayers if it contains
// blank gaps or mixes drawn frames and symbols.
// ============================================================
function exportLayer(doc, timeline, layer, layerIndex, versionFolder, fps, warnings) {
    var layerName    = sanitiseName(layer.name);
    var layerFolder  = versionFolder + layerName + "/";
    var frames       = layer.frames;
    var layerWarnings = [];

    if (!frames || frames.length === 0) return null;

    // Show only this layer for clean PNG export
    var allLayers = timeline.layers;
    var originalVisibility = [];
    for (var i = 0; i < allLayers.length; i++) {
        originalVisibility.push(allLayers[i].visible);
        allLayers[i].visible = (i === layerIndex);
    }

    // Layer folder created only if drawn frames are found
    var layerFolderCreated = false;

    var aeLayers = [];
    var currentAELayer = null;
    var pngCounter = 1;
    var f = 0;

    while (f < frames.length) {
        var frame = frames[f];
        if (frame.startFrame !== f) { f++; continue; }

        if (frame.isEmpty) {
            if (currentAELayer) {
                currentAELayer.outPoint = f;
                aeLayers.push(currentAELayer);
                currentAELayer = null;
            }
            f += frame.duration;
            continue;
        }

        var frameType = getFrameType(frame);
        var isSymbol  = (frameType === "symbol");

        if (frameType === "mixed") {
            layerWarnings.push("Frame " + f + " has a drawing and a symbol on the same layer – the drawing is ignored. Move the drawing to its own layer for it to export.");
            frameType = "symbol";
            isSymbol  = true;
        }
        if (isSymbol) {
            // Close any open drawn aeLayer
            if (currentAELayer) {
                currentAELayer.outPoint = f;
                aeLayers.push(currentAELayer);
                currentAELayer = null;
            }

            // Record one instance per symbol element on this frame
            for (var e = 0; e < frame.elements.length; e++) {
                var ele = frame.elements[e];
                if (ele.elementType !== "instance" || ele.instanceType !== "symbol") continue;
                var symName = sanitiseName(ele.libraryItem.name);
                var playMode = ele.loop;
                var instanceFirstFrame = ele.firstFrame || 0;
                var instanceLastFrame  = ele.lastFrame;

                var playType;
                if (playMode === "single frame") {
                    playType = "still";
                    instanceLastFrame = -1;
                } else if (playMode === "play once") {
                    playType = "once";
                    if (instanceLastFrame !== -1 && instanceLastFrame <= instanceFirstFrame) {
                        layerWarnings.push("Frame " + f + ": last frame (" + (instanceLastFrame + 1) + ") must be greater than first frame (" + (instanceFirstFrame + 1) + ") – last frame ignored.");
                        instanceLastFrame = -1;
                    }
                } else if (playMode === "play once reverse") {
                    playType = "once";
                    instanceFirstFrame = 0;
                    instanceLastFrame  = -1;
                    layerWarnings.push("Frame " + f + ": reverse play once is not supported – exported as forward play once. Rearrange manually in AE.");
                } else if (playMode === "loop reverse") {
                    playType = "loop";
                    instanceFirstFrame = 0;
                    instanceLastFrame  = -1;
                    layerWarnings.push("Frame " + f + ": reverse loop is not supported – exported as forward loop. Rearrange manually in AE.");
                } else {
                    playType = "loop";
                    if (instanceLastFrame !== -1 && instanceLastFrame <= instanceFirstFrame) {
                        layerWarnings.push("Frame " + f + ": last frame (" + (instanceLastFrame + 1) + ") must be greater than first frame (" + (instanceFirstFrame + 1) + ") – last frame ignored.");
                        instanceLastFrame = -1;
                    }
                }

                var mat = ele.matrix;

                if (Math.abs(ele.skewX - ele.skewY) < 1) {
                    // equal skew – treated as rotation, no warning needed
                } else if (ele.skewX * ele.skewY < 0) {
                    layerWarnings.push("Frame " + f + ": symbol '" + symName + "' has opposite-sign skew (skewX=" + Math.round(ele.skewX * 10) / 10 + ", skewY=" + Math.round(ele.skewY * 10) / 10 + ") – cannot be reproduced in AE, skew ignored.");
                } else {
                    layerWarnings.push("Frame " + f + ": symbol '" + symName + "' has uneven skew (skewX=" + Math.round(ele.skewX * 10) / 10 + ", skewY=" + Math.round(ele.skewY * 10) / 10 + ") – approximated in AE.");
                }

                aeLayers.push({
                    layerType: "symbol",
                    type: playType,
                    symbolRef: symName,
                    firstFrame: instanceFirstFrame,
                    lastFrame: instanceLastFrame,
                    inPoint: f,
                    outPoint: f + frame.duration,
                    transformX: ele.transformX,
                    transformY: ele.transformY,
                    skewX: ele.skewX,
                    skewY: ele.skewY,
                    matrix: { a: mat.a, b: mat.b, c: mat.c, d: mat.d, tx: mat.tx, ty: mat.ty }
                });
            }

        } else {
            // Drawn frame
            if (!currentAELayer) {
                if (!TEST_MODE && !layerFolderCreated) {
                    FLfile.createFolder(FLfile.platformPathToURI(layerFolder));
                    layerFolderCreated = true;
                }
                currentAELayer = {
                    layerType: "drawn",
                    type: "sequ",
                    inPoint: f,
                    outPoint: f + frame.duration,
                    folder: layerFolder,
                    keyframes: []
                };
            }

            var pngName = layerName + "_" + padNum(pngCounter, 3) + ".png";

            if (!TEST_MODE) {
                timeline.currentFrame = f;
                doc.exportPNG(FLfile.platformPathToURI(layerFolder + pngName), true, true);
            }

            currentAELayer.keyframes.push({ mainFrame: f, duration: frame.duration, png: pngName });
            currentAELayer.outPoint = f + frame.duration;
            pngCounter++;
        }

        f += frame.duration;
    }

    if (currentAELayer) aeLayers.push(currentAELayer);

    // Restore layer visibility
    for (var i = 0; i < allLayers.length; i++) {
        allLayers[i].visible = originalVisibility[i];
    }

    return { name: layerName, layerIndex: layerIndex, aeLayers: aeLayers, warnings: layerWarnings };
}

// ============================================================
// GET FRAME TYPE
// ============================================================
function getFrameType(frame) {
    if (frame.isEmpty || frame.elements.length === 0) return "empty";

    var hasShape = false, hasSymbol = false;
    for (var e = 0; e < frame.elements.length; e++) {
        var ele = frame.elements[e];
        if (ele.elementType === "instance" && ele.instanceType === "symbol") {
            hasSymbol = true;
        } else {
            hasShape = true;
        }
    }

    if (hasShape && hasSymbol) return "mixed";  // drawing + symbol – flatten
    if (hasSymbol) return "symbol";             // one or more symbols
    return "shape";
}

// ============================================================
// UTILITIES
// ============================================================
function getVersionFolder(basePath) {
    for (var v = 1; v < 1000; v++) {
        var candidate = basePath + "v" + padNum(v, 3) + "/";
        if (!FLfile.exists(FLfile.platformPathToURI(candidate))) return candidate;
    }
    return basePath + "v999/";
}

function sanitiseName(name) {
    return name.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function padNum(n, digits) {
    var s = "" + n;
    while (s.length < digits) s = "0" + s;
    return s;
}

function log(msg) { fl.trace(msg); }

function toJSON(obj, pretty) { return _toJSON(obj, 0, pretty); }

function _toJSON(obj, depth, pretty) {
    var t = typeof obj;
    if (t !== "object" || obj === null) {
        return t === "string" ? '"' + obj + '"' : String(obj);
    }
    var arr = obj.constructor === Array;
    var items = [], indent = "";
    if (pretty) for (var i = 0; i <= depth; i++) indent += "  ";
    var joinStr = pretty ? ",\n" + indent : ",";
    for (var k in obj) {
        var v = obj[k];
        if (typeof v === "function") continue;
        var vStr = (typeof v === "object" && v !== null)
            ? _toJSON(v, depth + 1, pretty)
            : (typeof v === "string" ? '"' + v + '"' : String(v));
        items.push(arr ? vStr : ('"' + k + '": ' + vStr));
    }
    var open = arr ? "[" : "{", close = arr ? "]" : "}";
    if (pretty) return open + "\n" + indent + items.join(joinStr) + "\n" + indent.slice(2) + close;
    return open + items.join(",") + close;
}

if (!Object.keys) {
    Object.keys = function(obj) {
        var keys = [];
        for (var k in obj) { if (obj.hasOwnProperty(k)) keys.push(k); }
        return keys;
    };
}

// ============================================================
// RUN – only auto-runs when not called from render_queue.jsfl
// ============================================================
if (typeof RENDER_QUEUE_MODE === "undefined" || !RENDER_QUEUE_MODE) {
    fl.outputPanel.clear();
    main();
}
