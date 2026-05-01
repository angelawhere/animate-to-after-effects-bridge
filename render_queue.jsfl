// ============================================================
// render_queue.jsfl
// Batch exports multiple FLA files using animate_export.jsfl.
// Keep both files in the same folder.
//
// If USE_DEFAULT_FOLDER is set in animate_export.jsfl, that
// folder is used for all scenes. Otherwise you are prompted
// once and the location is remembered for next time.
// ============================================================

var FLA_LIST = [
    "C:/users/you/documents/project/c114_col04.fla",
    "C:/users/you/documents/project/c114_col05.fla",
    "C:/users/you/documents/project/c114_col06.fla",
];

// ============================================================
// RUN
// ============================================================
fl.outputPanel.clear();

var exportScriptURI = fl.scriptURI.replace(/[^\/]+$/, "animate_export.jsfl");

if (!FLfile.exists(exportScriptURI)) {
    fl.trace("ERROR: animate_export.jsfl not found at: " + FLfile.uriToPlatformPath(exportScriptURI));
    fl.trace("Keep both scripts in the same folder.");
} else {
    // Prevent animate_export.jsfl from auto-running main() on load
    RENDER_QUEUE_MODE = true;
    fl.runScript(exportScriptURI);

    // Resolve output folder
    var outputFolder = null;

    if (typeof USE_DEFAULT_FOLDER !== "undefined" && USE_DEFAULT_FOLDER &&
        typeof DEFAULT_FOLDER !== "undefined" && DEFAULT_FOLDER &&
        FLfile.exists(FLfile.platformPathToURI(DEFAULT_FOLDER))) {
        outputFolder = DEFAULT_FOLDER;
        fl.trace("Using default folder: " + outputFolder);
    } else {
        var lastFolder = "";
        try { lastFolder = fl.getPrefString("AnimateRenderQueue", "lastFolder", ""); } catch(e) {}
        var folderURI = fl.browseForFolderURL("Select output folder for all scenes", lastFolder);
        if (!folderURI) {
            fl.trace("Cancelled.");
        } else {
            outputFolder = FLfile.uriToPlatformPath(folderURI).split("\\").join("/") + "/";
            try { fl.setPrefString("AnimateRenderQueue", "lastFolder", folderURI); } catch(e) {}
            fl.trace("Using folder: " + outputFolder);
        }
    }

    if (outputFolder) {
        fl.trace("=== Render Queue: " + FLA_LIST.length + " scene(s) ===");

        for (var i = 0; i < FLA_LIST.length; i++) {
            var flaPath = FLA_LIST[i];
            fl.trace("\n[" + (i + 1) + "/" + FLA_LIST.length + "] " + flaPath);

            if (!FLfile.exists(FLfile.platformPathToURI(flaPath))) {
                fl.trace("  ERROR: File not found, skipping.");
                continue;
            }

            main(flaPath, outputFolder);

            // Close the file after export
            var doc = fl.getDocumentDOM();
            if (doc) fl.closeDocument(doc, false);
        }

        fl.trace("\n=== Render Queue complete ===");
    }
}
