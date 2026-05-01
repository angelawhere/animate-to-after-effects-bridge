// ============================================================
// ae_import.jsx
// Imports scene JSON exported by animate_export.jsfl into
// After Effects. Select the FLA output folder when prompted.
//
// Builds one symbol comp per unique symbol, and one master
// comp with all layers placed and time-remapped.
// ============================================================

// ============================================================
// MAIN
// ============================================================
function main() {
    var lastFolder = app.settings.haveSetting("AnimateImport", "lastFolder")
        ? app.settings.getSetting("AnimateImport", "lastFolder") : "";
    var baseFolder = Folder.selectDialog("Select the FLA output folder", lastFolder);
    if (!baseFolder) return;
    app.settings.saveSetting("AnimateImport", "lastFolder", baseFolder.fsName);

    var latestVersion = getLatestVersionFolder(baseFolder);
    if (!latestVersion) { alert("No version folders found in: " + baseFolder.fsName); return; }

    var sceneJSON = getSceneJSON(latestVersion);
    if (!sceneJSON) { alert("No scene JSON found in: " + latestVersion.fsName); return; }

    var scene = readJSON(sceneJSON);
    if (!scene) return;

    var fps      = scene.fps;
    var flaName  = baseFolder.name;

    // Create project folder for this import run
    var importFolder = app.project.items.addFolder(getNextItemName(flaName + "_" + latestVersion.name, "folder"));

    // Build symbol comps — each gets its own subfolder inside importFolder
    var symbolComps = {};
    for (var symName in scene.symbols) {
        var symComp = buildSymbolComp(scene.symbols[symName], symName, fps, importFolder, scene.width, scene.height);
        if (symComp) symbolComps[symName] = symComp;
    }

    // Create master comp
    var masterComp = app.project.items.addComp(
        getNextItemName(flaName + "_" + latestVersion.name, "comp"),
        scene.width, scene.height, 1,
        scene.totalFrames / fps, fps
    );
    masterComp.bgColor = [1, 1, 1];

    // Import layers in reverse order (bottom first in AE)
    var layers = scene.layers;
    for (var i = layers.length - 1; i >= 0; i--) {
        importLayer(layers[i], masterComp, importFolder, symbolComps, fps, scene);
    }

    masterComp.openInViewer();
    alert("Import complete.");
}

// ============================================================
// BUILD SYMBOL COMP
// One comp per unique symbol, one footage layer per symbol layer.
// Footage is centered on stage. Time Remap mirrors internal keyframes.
// ============================================================
function buildSymbolComp(symData, symName, fps, importFolder, stageWidth, stageHeight) {
    // Symbol comp at root import folder level
    var symComp = app.project.items.addComp(
        getNextItemName(symName, "comp"),
        stageWidth, stageHeight, 1,
        symData.totalFrames / fps, fps
    );
    symComp.bgColor = [1, 1, 1];
    symComp.parentFolder = importFolder;

    // Footage subfolder named after symbol
    var symFolder = app.project.items.addFolder(getNextItemName(symName, "folder"));
    symFolder.parentFolder = importFolder;

    var symLayers = symData.layers;
    for (var i = symLayers.length - 1; i >= 0; i--) {
        var layerData = symLayers[i];
        if (!layerData.keyframes || layerData.keyframes.length === 0) continue;

        var folderPath = layerData.folder.replace(/\\/g, "/");
        var firstPNG = new File(folderPath + layerData.keyframes[0].png);
        if (!firstPNG.exists) { alert("Symbol PNG not found: " + firstPNG.fsName); continue; }

        var importOptions = new ImportOptions(firstPNG);
        importOptions.sequence = true;
        importOptions.forceAlphabetical = true;
        var footage = app.project.importFile(importOptions);
        footage.name = symName + "_" + layerData.name;
        footage.mainSource.conformFrameRate = fps;
        footage.parentFolder = symFolder; // same level as the comp

        var footageLayer = symComp.layers.add(footage);
        footageLayer.name = layerData.name;
        footageLayer.transform.anchorPoint.setValue([footage.width / 2, footage.height / 2]);
        footageLayer.transform.position.setValue([stageWidth / 2, stageHeight / 2]);
        footageLayer.timeRemapEnabled = true;

        var timeRemap = footageLayer.property("Time Remap");
        if (timeRemap.numKeys >= 2) timeRemap.removeKey(2);

        var numKF = layerData.keyframes.length;
        for (var k = 0; k < numKF; k++) {
            var kf = layerData.keyframes[k];
            timeRemap.setValueAtTime(kf.frame / fps, k / fps);
            var keyIdx = timeRemap.nearestKeyIndex(kf.frame / fps);
            timeRemap.setInterpolationTypeAtKey(keyIdx, KeyframeInterpolationType.HOLD);
        }

        removeOrphanKey(timeRemap);

        footageLayer.inPoint = 0;
        footageLayer.outPoint = symData.totalFrames / fps;
    }

    return symComp;
}

// ============================================================
// IMPORT LAYER
// ============================================================
function importLayer(layerData, masterComp, importFolder, symbolComps, fps, scene) {
    for (var a = 0; a < layerData.aeLayers.length; a++) {
        var aeLayer = layerData.aeLayers[a];
        if (aeLayer.layerType === "drawn") {
            importDrawnLayer(aeLayer, layerData.name, masterComp, importFolder, fps);
        } else if (aeLayer.layerType === "symbol") {
            importSymbolInstance(aeLayer, layerData.name, masterComp, symbolComps, fps, scene);
        }
    }
}

// ============================================================
// IMPORT DRAWN LAYER
// Time Remap keys at footage time 0+, startTime positions layer.
// ============================================================
function importDrawnLayer(aeLayer, layerName, masterComp, importFolder, fps) {
    if (!aeLayer.keyframes || aeLayer.keyframes.length === 0) return;

    var folderPath = aeLayer.folder.replace(/\\/g, "/");
    var firstPNG = new File(folderPath + aeLayer.keyframes[0].png);
    if (!firstPNG.exists) { alert("PNG not found: " + firstPNG.fsName); return; }

    var importOptions = new ImportOptions(firstPNG);
    importOptions.sequence = true;
    importOptions.forceAlphabetical = true;
    var footage = app.project.importFile(importOptions);
    footage.name = layerName;
    footage.mainSource.conformFrameRate = fps;
    footage.parentFolder = importFolder;

    var footageLayer = masterComp.layers.add(footage);
    footageLayer.name = layerName;
    footageLayer.timeRemapEnabled = true;

    var timeRemap = footageLayer.property("Time Remap");
    if (timeRemap.numKeys >= 2) timeRemap.removeKey(2);

    var numKF = aeLayer.keyframes.length;
    var seqTime = 0;
    var firstKeyOverwritten = false;

    for (var k = 0; k < numKF; k++) {
        var kf = aeLayer.keyframes[k];
        timeRemap.setValueAtTime(seqTime, k / fps);
        var keyIdx = timeRemap.nearestKeyIndex(seqTime);
        timeRemap.setInterpolationTypeAtKey(keyIdx, KeyframeInterpolationType.HOLD);
        if (Math.abs(seqTime) < 0.001) firstKeyOverwritten = true;
        seqTime += kf.duration / fps;
    }

    if (!firstKeyOverwritten) {
        for (var k = 1; k <= timeRemap.numKeys; k++) {
            if (Math.abs(timeRemap.keyTime(k)) < 0.001) { timeRemap.removeKey(k); break; }
        }
    }

    // startTime positions layer on comp timeline; inPoint/outPoint set visibility
    footageLayer.startTime = aeLayer.inPoint / fps;
    footageLayer.inPoint   = aeLayer.inPoint / fps;
    footageLayer.outPoint  = aeLayer.outPoint / fps;
}

// ============================================================
// IMPORT SYMBOL INSTANCE
// Places symbol comp in master comp. Instance Time Remap handles
// firstFrame/lastFrame offset and playback type (loop/once/still).
// Matrix transform sets position, scale, rotation, skew.
// startTime offsets layer so firstFrame plays at inPoint.
// ============================================================
function importSymbolInstance(aeLayer, layerName, masterComp, symbolComps, fps, scene) {
    var symName = aeLayer.symbolRef;
    var symComp = symbolComps[symName];
    if (!symComp) { alert("Symbol comp not found: " + symName); return; }

    var symData    = scene.symbols[symName];
    var firstFrame = aeLayer.firstFrame || 0;
    var inPoint    = aeLayer.inPoint;
    var outPoint   = aeLayer.outPoint;
    var playType   = aeLayer.type;

    var instanceLayer = masterComp.layers.add(symComp);
    instanceLayer.name  = layerName + "_" + symName;
    instanceLayer.label = 14; // cyan

    applyMatrix(instanceLayer, aeLayer.matrix, aeLayer.transformX, aeLayer.transformY, symData, aeLayer.skewX || 0, aeLayer.skewY || 0);

    // Enable Time Remap before positioning
    instanceLayer.timeRemapEnabled = true;
    var timeRemap    = instanceLayer.property("Time Remap");
    var symTotalTime = symData.totalFrames / fps;
    var hasFirst = firstFrame > 0;
    var hasLast  = (aeLayer.lastFrame !== undefined && aeLayer.lastFrame !== -1);
    var lastFrame = hasLast ? aeLayer.lastFrame : -1;

    if (playType === "still") {
        if (timeRemap.numKeys >= 2) timeRemap.removeKey(2);
        timeRemap.setValueAtTime(firstFrame / fps, firstFrame / fps);
        if (hasFirst) {
            for (var k = 1; k <= timeRemap.numKeys; k++) {
                if (Math.abs(timeRemap.keyTime(k)) < 0.001) { timeRemap.removeKey(k); break; }
            }
        }

    } else if (playType === "once") {
        if (hasFirst) {
            timeRemap.setValueAtTime(firstFrame / fps, firstFrame / fps);
            for (var k = 1; k <= timeRemap.numKeys; k++) {
                if (Math.abs(timeRemap.keyTime(k)) < 0.001) { timeRemap.removeKey(k); break; }
            }
        }
        // Add penultimate key at last actual frame, remove original end key
        var onceEndTime = hasLast ? lastFrame / fps : symTotalTime - 1 / fps;
        timeRemap.setValueAtTime(onceEndTime, onceEndTime);
        for (var k = timeRemap.numKeys; k >= 1; k--) {
            if (timeRemap.keyTime(k) > onceEndTime + 0.001) { timeRemap.removeKey(k); break; }
        }

    } else {
        // Loop
        if (hasLast) {
            // Trim to firstFrame..lastFrame
            if (hasFirst) {
                timeRemap.setValueAtTime(firstFrame / fps, firstFrame / fps);
                for (var k = 1; k <= timeRemap.numKeys; k++) {
                    if (Math.abs(timeRemap.keyTime(k)) < 0.001) { timeRemap.removeKey(k); break; }
                }
            }
            timeRemap.setValueAtTime(lastFrame / fps, lastFrame / fps);
            timeRemap.setValueAtTime((lastFrame + 1) / fps, firstFrame / fps);
            for (var k = timeRemap.numKeys; k >= 1; k--) {
                if (timeRemap.keyTime(k) > (lastFrame + 1) / fps + 0.001) { timeRemap.removeKey(k); break; }
            }
        } else {
            // Full loop — add penultimate key and closing key
            timeRemap.setValueAtTime(symTotalTime - 1 / fps, symTotalTime - 1 / fps);
            timeRemap.setValueAtTime(symTotalTime, 0);
            for (var k = timeRemap.numKeys; k >= 1; k--) {
                if (timeRemap.keyTime(k) > symTotalTime + 0.001) { timeRemap.removeKey(k); break; }
            }
        }
        timeRemap.expression = "loopOut();";
    }

    // Set positioning last — startTime offsets so firstFrame plays at inPoint
    instanceLayer.startTime = inPoint / fps - firstFrame / fps;
    instanceLayer.inPoint   = inPoint / fps;
    instanceLayer.outPoint  = outPoint / fps;
}

// ============================================================
// APPLY MATRIX TRANSFORM
// Equal skewX/Y is treated as rotation (same as Animate).
// Uneven skew is approximated: rotation = average,
// remainder applied via Transform effect.
// ============================================================
function applyMatrix(layer, matrix, transformX, transformY, symData, skewX, skewY) {
    var a = matrix.a, b = matrix.b, c = matrix.c, d = matrix.d;
    var scaleX = Math.sqrt(a * a + b * b);
    var scaleY = Math.sqrt(c * c + d * d);
    var skX = skewX || 0, skY = skewY || 0;
    var rotation, remainingSkew;

    if (Math.abs(skX - skY) < 1) {
        // Equal skew — treat as pure rotation
        rotation = skX;
        remainingSkew = 0;
    } else if (skX * skY < 0) {
        // Opposite-sign skew — cannot reproduce in AE, apply rotation only
        rotation = (skX + skY) / 2;
        remainingSkew = 0;
    } else {
        // Same-sign uneven skew — approximate: rotation = average, remainder as skew
        rotation = (skX + skY) / 2;
        remainingSkew = (skX - skY) / 2;
    }

    layer.transform.anchorPoint.setValue([symData.compAnchorX, symData.compAnchorY]);
    layer.transform.position.setValue([transformX, transformY]);
    layer.transform.scale.setValue([scaleX * 100, scaleY * 100]);
    layer.transform.rotation.setValue(rotation);

    if (Math.abs(remainingSkew) > 0.01) {
        var fx = layer.property("Effects").addProperty("ADBE Geometry2");
        fx.property("ADBE Geometry2-0005").setValue(-remainingSkew);
        fx.property("ADBE Geometry2-0006").setValue(0);
    }
}

// ============================================================
// REMOVE ORPHAN KEY AT T=0
// ============================================================
function removeOrphanKey(timeRemap) {
    for (var k = 1; k <= timeRemap.numKeys; k++) {
        if (Math.abs(timeRemap.keyTime(k)) < 0.001) return; // key at 0 is valid
    }
    // No key at 0 — remove the default one (will be at t=0 if not overwritten)
    for (var k = 1; k <= timeRemap.numKeys; k++) {
        if (timeRemap.keyTime(k) === 0) { timeRemap.removeKey(k); return; }
    }
}

// ============================================================
// UTILITIES
// ============================================================
function readJSON(file) {
    file.open("r");
    var content = file.read();
    file.close();
    try { return eval("(" + content + ")"); }
    catch(e) { alert("Failed to parse JSON: " + file.fsName + "\n" + e.toString()); return null; }
}

function getLatestVersionFolder(baseFolder) {
    var allFiles = baseFolder.getFiles();
    var folders = [];
    for (var i = 0; i < allFiles.length; i++) {
        if (allFiles[i] instanceof Folder && allFiles[i].name.match(/^v\d+$/)) folders.push(allFiles[i]);
    }
    if (folders.length === 0) return null;
    folders.sort(function(a, b) { return a.name > b.name ? 1 : -1; });
    return folders[folders.length - 1];
}

function getSceneJSON(versionFolder) {
    var allFiles = versionFolder.getFiles();
    for (var i = 0; i < allFiles.length; i++) {
        if (allFiles[i] instanceof File && allFiles[i].name.match(/\.json$/i)) return allFiles[i];
    }
    return null;
}

function getNextItemName(baseName, itemType) {
    // itemType: "comp", "folder", "footage", or undefined (check all)
    var existing = {};
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!itemType ||
            (itemType === "comp"    && item instanceof CompItem) ||
            (itemType === "folder"  && item instanceof FolderItem) ||
            (itemType === "footage" && item instanceof FootageItem)) {
            existing[item.name] = true;
        }
    }
    if (!existing[baseName]) return baseName;
    for (var v = 2; v < 1000; v++) {
        var candidate = baseName + " (" + v + ")";
        if (!existing[candidate]) return candidate;
    }
    return baseName + " (999)";
}

function padNum(n, digits) {
    var s = "" + n;
    while (s.length < digits) s = "0" + s;
    return s;
}

// ============================================================
// RUN
// ============================================================
main();
