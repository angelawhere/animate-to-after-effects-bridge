// ae_import.jsx
// Imports scene JSON exported by animate_export.jsfl into After Effects. Select the FLA output folder when prompted.
// Builds one symbol comp per unique symbol, and one master comp with all layers placed and time-remapped.

var VERSION = "1.0";

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

    var fps = scene.fps;
    var flaName = baseFolder.name;

    var importFolder = app.project.items.addFolder(getNextItemName(flaName + "_" + latestVersion.name, "folder"));

    var symbolComps = {};
    for (var symName in scene.symbols) {
        var symComp = buildSymbolComp(scene.symbols[symName], symName, fps, importFolder, scene.width, scene.height);
        if (symComp) symbolComps[symName] = symComp;
    }

    var masterComp = app.project.items.addComp(
        getNextItemName(flaName + "_" + latestVersion.name, "comp"),
        scene.width, scene.height, 1,
        scene.totalFrames / fps, fps
    );
    masterComp.bgColor = [1, 1, 1];

    // import in reverse order so the first layer in Animate ends up on top in AE
    var layers = scene.layers;
    for (var i = layers.length - 1; i >= 0; i--) {
        importLayer(layers[i], masterComp, importFolder, symbolComps, fps, scene);
    }

    masterComp.openInViewer();
    alert("Import complete (v" + VERSION + ").");
}

// one comp per unique symbol, one footage layer per symbol layer, footage centered on stage with Time Remap mirroring the internal keyframes
function buildSymbolComp(symData, symName, fps, importFolder, stageWidth, stageHeight) {
    var symComp = app.project.items.addComp(
        getNextItemName(symName, "comp"),
        stageWidth, stageHeight, 1,
        symData.totalFrames / fps, fps
    );
    symComp.bgColor = [1, 1, 1];
    symComp.parentFolder = importFolder;

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
        footage.parentFolder = symFolder;

        var footageLayer = symComp.layers.add(footage);
        footageLayer.name = layerData.name;
        footageLayer.transform.anchorPoint.setValue([footage.width / 2, footage.height / 2]);
        footageLayer.transform.position.setValue([stageWidth / 2, stageHeight / 2]);
        footageLayer.timeRemapEnabled = true;

        var timeRemap = footageLayer.property("Time Remap");
        if (timeRemap.numKeys >= 2) timeRemap.removeKey(2); // remove AE's default second key before writing our own

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

    // startTime positions the layer on the comp timeline; inPoint/outPoint set visibility
    footageLayer.startTime = aeLayer.inPoint / fps;
    footageLayer.inPoint = aeLayer.inPoint / fps;
    footageLayer.outPoint = aeLayer.outPoint / fps;
}

// places the symbol comp in the master comp; instance Time Remap handles firstFrame/lastFrame offset and playback type (loop/once/still)
// matrix transform sets position, scale, rotation, skew; startTime offsets the layer so firstFrame plays at inPoint
function importSymbolInstance(aeLayer, layerName, masterComp, symbolComps, fps, scene) {
    var symName = aeLayer.symbolRef;
    var symComp = symbolComps[symName];
    if (!symComp) { alert("Symbol comp not found: " + symName); return; }

    var symData = scene.symbols[symName];
    var firstFrame = aeLayer.firstFrame || 0;
    var inPoint = aeLayer.inPoint;
    var outPoint = aeLayer.outPoint;
    var playType = aeLayer.type;

    var instanceLayer = masterComp.layers.add(symComp);
    instanceLayer.name = layerName + "_" + symName;
    instanceLayer.label = 14; // cyan

    applyMatrix(instanceLayer, aeLayer.matrix, aeLayer.transformX, aeLayer.transformY, symData, aeLayer.skewX || 0, aeLayer.skewY || 0);

    instanceLayer.timeRemapEnabled = true;
    var timeRemap = instanceLayer.property("Time Remap");
    var symTotalTime = symData.totalFrames / fps;
    var hasFirst = firstFrame > 0;
    var hasLast = (aeLayer.lastFrame !== undefined && aeLayer.lastFrame !== -1);
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
        var onceEndTime = hasLast ? lastFrame / fps : symTotalTime - 1 / fps;
        timeRemap.setValueAtTime(onceEndTime, onceEndTime);
        for (var k = timeRemap.numKeys; k >= 1; k--) {
            if (timeRemap.keyTime(k) > onceEndTime + 0.001) { timeRemap.removeKey(k); break; }
        }

    } else {
        if (hasLast) {
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
            timeRemap.setValueAtTime(symTotalTime - 1 / fps, symTotalTime - 1 / fps);
            timeRemap.setValueAtTime(symTotalTime, 0);
            for (var k = timeRemap.numKeys; k >= 1; k--) {
                if (timeRemap.keyTime(k) > symTotalTime + 0.001) { timeRemap.removeKey(k); break; }
            }
        }
        timeRemap.expression = "loopOut();";
    }

    instanceLayer.startTime = inPoint / fps - firstFrame / fps;
    instanceLayer.inPoint = inPoint / fps;
    instanceLayer.outPoint = outPoint / fps;
}

// equal skewX/Y is treated as rotation, same as Animate; uneven skew is approximated, with rotation set to the average and the remainder applied via the Transform effect
function applyMatrix(layer, matrix, transformX, transformY, symData, skewX, skewY) {
    var a = matrix.a, b = matrix.b, c = matrix.c, d = matrix.d;
    var scaleX = Math.sqrt(a * a + b * b);
    var scaleY = Math.sqrt(c * c + d * d);
    var skX = skewX || 0, skY = skewY || 0;
    var rotation, remainingSkew;

    if (Math.abs(skX - skY) < 1) {
        rotation = skX;
        remainingSkew = 0;
    } else if (skX * skY < 0) {
        rotation = (skX + skY) / 2;
        remainingSkew = 0;
    } else {
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

function removeOrphanKey(timeRemap) {
    for (var k = 1; k <= timeRemap.numKeys; k++) {
        if (Math.abs(timeRemap.keyTime(k)) < 0.001) return;
    }
    for (var k = 1; k <= timeRemap.numKeys; k++) {
        if (timeRemap.keyTime(k) === 0) { timeRemap.removeKey(k); return; }
    }
}

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
    // itemType: "comp", "folder", "footage", or undefined to check all
    var existing = {};
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!itemType ||
            (itemType === "comp" && item instanceof CompItem) ||
            (itemType === "folder" && item instanceof FolderItem) ||
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

main();
