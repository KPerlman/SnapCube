// CaptureConfig.js
// Exposes camera's render target texture so other scripts can sample

//@input Asset.RenderTarget captureRT

function initCaptureRef() {
    if (!script.captureRT) {
        print("[CaptureConfig] No RenderTarget assigned to captureRT input.");
        return;
    }

    // Try to grab color texture from Render Target
    var tex = script.captureRT.colorTexture;

    if (!tex) {
        print("[CaptureConfig] captureRT has no colorTexture. " +
              "Check that your capture camera is rendering into this Render Target.");
        return;
    }

    global.captureTexRef = tex;

    print("[CaptureConfig] captureTexRef set. Ready for sampling.");
    print("               texture = " + tex);
}

// Run after component is awake so inputs are valid
var startEvent = script.createEvent("OnStartEvent");
startEvent.bind(initCaptureRef);
