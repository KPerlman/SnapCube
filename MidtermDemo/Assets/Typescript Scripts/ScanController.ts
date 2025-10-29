// ScanController.ts
// - beginScan() after pad lock, first pinch locks pad, subsequent pinches capture faces
// - sample 9 regions from render target on each face
// - after 6 faces...
//    - classify all stickers by normalized color distance
//    - log cube nets
//    - validate counts
//    - build state string for kociemba solver
//    - post to Lambda
//    - show solution in UI

import { UIController } from "./UIController";

const SIK = require("SpectaclesInteractionKit.lspkg/SIK").SIK;
const InteractorModule = require("SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor");
const InteractorTriggerType = InteractorModule.InteractorTriggerType;

declare const ProceduralTextureProvider: any;

type RGBVec = vec3;

@component
export class ScanController extends BaseScriptComponent {
  @input ui: UIController;
  @input padObject: SceneObject;

  @input("Component.Camera") captureCamera: any;
  @input("Asset.RenderTarget") captureRT: any;

  @input("Asset.Texture") @allowUndefined captureTexOverride: any;

  @input("Asset.InternetModule") @allowUndefined internetModule: any;
  @input("string") @allowUndefined lambdaUrl: string;

  private currentFaceIndex = 0;
  private totalFaces = 6;
  private capturedFaces: Array<Array<RGBVec>> = [];
  private scanningActive = false;
  private armedForCapture = false;

  private faceSampleNorm = 0.16;

  // Must match scan order
  private faceLettersOrder: Array<string> = ["U", "R", "F", "D", "L", "B"];

  onAwake() {
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
  }

  beginScan() {
    this.scanningActive = true;
    this.armedForCapture = false;
    this.currentFaceIndex = 0;
    this.capturedFaces = [];

    if (this.ui) this.ui.showScanUI(this.currentFaceIndex, this.totalFaces);

    print(
      "[ScanController] beginScan(): Starting capture at face " +
        (this.currentFaceIndex + 1) +
        "/" +
        this.totalFaces
    );
  }

  onUpdate() {
    if (!this.scanningActive) return;

    const interactor = this.getPrimaryInteractor();
    if (!interactor) return;

    const prevTrig = interactor.previousTrigger;
    const curTrig = interactor.currentTrigger;
    const pinchReleasedNow =
      prevTrig !== InteractorTriggerType.None &&
      curTrig === InteractorTriggerType.None;

    if (!this.armedForCapture) {
      if (pinchReleasedNow) {
        this.armedForCapture = true;
        print("[ScanController] armed scanning on first real pinch");
      }
      return;
    }

    if (pinchReleasedNow) this.doCaptureCurrentFace();
  }

  private doCaptureCurrentFace() {
    if (this.currentFaceIndex >= this.totalFaces) return;

    // Debug source and dimensions
    {
      const tex = this.getCaptureTexture();
      if (!tex) {
        print("[ScanController] WARNING: no capture texture at capture time.");
      } else {
        let wGuess = 0,
          hGuess = 0;
        if (tex.getWidth && tex.getHeight) {
          wGuess = tex.getWidth();
          hGuess = tex.getHeight();
        } else {
          const provGuess = this.getReadableProvider(tex);
          if (provGuess && provGuess.getWidth) {
            wGuess = provGuess.getWidth();
            hGuess = provGuess.getHeight();
          }
        }
        print(
          "[ScanController] capture source texture size ~ " + wGuess + "x" + hGuess
        );
      }
    }

    // Sample 3x3
    const rgbList: Array<RGBVec> = [];
    for (let idx = 0; idx < 9; idx++) {
      const rectNorm = this.getStickerRectNorm(idx);
      const rgb = this.sampleRegionNormalized(rectNorm);
      rgbList.push(rgb);
    }
    this.capturedFaces.push(rgbList);

    print(
      "[ScanController] Captured face " +
        (this.currentFaceIndex + 1) +
        "/" +
        this.totalFaces
    );
    for (let i = 0; i < rgbList.length; i++) {
      const c = rgbList[i];
      print(
        "  sticker " +
          i +
          " rgb=(" +
          Math.round(c.x) +
          "," +
          Math.round(c.y) +
          "," +
          Math.round(c.z) +
          ")"
      );
    }

    this.currentFaceIndex++;

    if (this.currentFaceIndex >= this.totalFaces) {
      this.finishScan();
    } else {
      if (this.ui) this.ui.showScanUI(this.currentFaceIndex, this.totalFaces);
    }
  }

  private async finishScan() {
    this.scanningActive = false;
    this.armedForCapture = false;

    if (this.ui) this.ui.showDoneUI();

    print("[ScanController] All faces captured. Building cube state...");

    // classify
    const classifiedFaces = this.classifyAllFaces();

    // log cube nets
    this.logCubeNet_IndexReference();
    this.logCubeNet_Classified(classifiedFaces);

    // validate counts
    const isValid = this.validateColorCounts(classifiedFaces);
    if (!isValid) {
      if (this.ui && this.ui.showSolution) {
        this.ui.showSolution("Bad scan. Try again closer / steadier.");
      }
      print("[ScanController] INVALID color distribution. Not sending to Lambda.");
      return;
    }

    // build string in URFDLB face order
    const cubeState = this.buildCubeStateString(classifiedFaces);
    print("[ScanController] Cube state = " + cubeState);

    // send to Lambda
    await this.sendToLambdaAndShowSolution(cubeState);
  }

  private getPrimaryInteractor() {
    const targeting = SIK.InteractionManager.getTargetingInteractors();
    if (targeting && targeting.length > 0) return targeting[0];

    if (SIK.InteractionManager.getInteractors) {
      const all = SIK.InteractionManager.getInteractors();
      if (all && all.length > 0) return all[0];
    }
    return null;
  }

  private getCaptureTexture(): any {
    if (this.captureTexOverride) {
      print("[ScanController] getCaptureTexture(): using captureTexOverride");
      return this.captureTexOverride;
    }
    if (this.captureCamera && this.captureCamera.renderTarget) {
      print(
        "[ScanController] getCaptureTexture(): using captureCamera.renderTarget"
      );
      return this.captureCamera.renderTarget;
    }
    if (this.captureRT && this.captureRT.targetTexture) {
      print("[ScanController] getCaptureTexture(): using captureRT.targetTexture");
      return this.captureRT.targetTexture;
    }
    const gcap = (global as any).captureInfo;
    if (gcap && gcap.texture) {
      print(
        "[ScanController] getCaptureTexture(): using global.captureInfo.texture (legacy)"
      );
      return gcap.texture;
    }
    print("[ScanController] getCaptureTexture(): no texture source found.");
    return null;
  }

  private getReadableProvider(tex: any): any {
    try {
      const procTex = ProceduralTextureProvider.createFromTexture(tex);
      if (procTex && procTex.control) return procTex.control;
    } catch (e) {
      print("[ScanController] getReadableProvider() failed: " + e);
    }
    if (tex && tex.control && tex.control.getPixels) return tex.control;
    return null;
  }

  private sampleRegionNormalized(rectNorm: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): RGBVec {
    const tex = this.getCaptureTexture();
    if (!tex) {
      print("[ScanController] sampleRegionNormalized: no capture texture (null).");
      return new vec3(255, 255, 255);
    }

    const prov = this.getReadableProvider(tex);
    if (!prov || !prov.getWidth || !prov.getHeight || !prov.getPixels) {
      print("[ScanController] sampleRegionNormalized: texture not readable yet.");
      return new vec3(255, 255, 255);
    }

    const W = prov.getWidth();
    const H = prov.getHeight();
    if (!W || !H) {
      print("[ScanController] sampleRegionNormalized: provider 0x0 size.");
      return new vec3(255, 255, 255);
    }

    let px = Math.floor(rectNorm.x * W);
    let py = Math.floor(rectNorm.y * H);
    let pw = Math.floor(rectNorm.w * W);
    let ph = Math.floor(rectNorm.h * H);

    if (pw < 1) pw = 1;
    if (ph < 1) ph = 1;
    if (px < 0) px = 0;
    if (py < 0) py = 0;
    if (px + pw > W) pw = W - px;
    if (py + ph > H) ph = H - py;

    print(
      "[ScanController] sampling tex " +
        W +
        "x" +
        H +
        " @ px rect [" +
        px +
        "," +
        py +
        ", " +
        pw +
        "x" +
        ph +
        "]"
    );

    const channels = 4;
    const buffer = new Uint8Array(pw * ph * channels);
    prov.getPixels(px, py, pw, ph, buffer);

    let rSum = 0,
      gSum = 0,
      bSum = 0;
    const numPx = pw * ph;
    for (let i = 0; i < numPx; i++) {
      const idx = i * 4;
      rSum += buffer[idx + 0];
      gSum += buffer[idx + 1];
      bSum += buffer[idx + 2];
    }
    return new vec3(rSum / numPx, gSum / numPx, bSum / numPx);
  }

  private getStickerRectNorm(idx: number) {
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    const faceSizeNorm = this.faceSampleNorm;
    const cellSizeNorm = faceSizeNorm / 3.0;
    const faceMinX = 0.5 - faceSizeNorm * 0.5;
    const faceMinY = 0.5 - faceSizeNorm * 0.5;
    return {
      x: faceMinX + col * cellSizeNorm,
      y: faceMinY + row * cellSizeNorm,
      w: cellSizeNorm,
      h: cellSizeNorm,
    };
  }


  private normalizeRGB(v: RGBVec): RGBVec {
    const sum = v.x + v.y + v.z;
    if (sum <= 1e-5) return new vec3(0, 0, 0);
    return new vec3(v.x / sum, v.y / sum, v.z / sum);
  }

  private normColorDistance(a: RGBVec, b: RGBVec): number {
    const dr = a.x - b.x;
    const dg = a.y - b.y;
    const db = a.z - b.z;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  private classifyAllFaces(): Array<Array<string>> {
    const faceLetters = this.faceLettersOrder;

    // center (index 4) per face
    const centersRaw: Array<RGBVec> = [];
    for (let f = 0; f < this.capturedFaces.length; f++) {
      centersRaw.push(this.capturedFaces[f][4]);
    }
    const centersNorm: Array<RGBVec> = centersRaw.map((c) => this.normalizeRGB(c));

    const out: Array<Array<string>> = [];
    for (let f = 0; f < this.capturedFaces.length; f++) {
      const stickers = this.capturedFaces[f];
      const classified: Array<string> = [];
      for (let s = 0; s < stickers.length; s++) {
        const sn = this.normalizeRGB(stickers[s]);
        let bestFace = 0;
        let bestDist = 1e9;
        for (let cf = 0; cf < centersNorm.length; cf++) {
          const d = this.normColorDistance(sn, centersNorm[cf]);
          if (d < bestDist) {
            bestDist = d;
            bestFace = cf;
          }
        }
        classified.push(faceLetters[bestFace] || "?");
      }
      out.push(classified);
    }
    return out;
  }

  private validateColorCounts(classifiedFaces: Array<Array<string>>): boolean {
    const letters = this.faceLettersOrder; // ["U","R","F","D","L","B"]
    const counts: { [k: string]: number } = {};
    letters.forEach((L) => (counts[L] = 0));

    for (let f = 0; f < classifiedFaces.length; f++) {
      for (let s = 0; s < classifiedFaces[f].length; s++) {
        const L = classifiedFaces[f][s];
        if (counts[L] === undefined) counts[L] = 0;
        counts[L] += 1;
      }
    }

    letters.forEach((L) =>
      print("[ScanController] color count " + L + " = " + counts[L])
    );

    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (counts[L] !== 9) {
        print(
          "[ScanController] INVALID count for " + L + ": " + counts[L] + " (expected 9)"
        );
        return false;
      }
    }
    return true;
  }

  private buildCubeStateString(classifiedFaces: Array<Array<string>>): string {
    let out = "";
    for (let f = 0; f < classifiedFaces.length; f++) {
      const face = classifiedFaces[f];
      for (let i = 0; i < face.length; i++) out += face[i];
    }
    return out;
  }

  // Log Net
  // 0 "************"
  // 1 "*A**B**C*"
  // 2 "************"
  // 3 "*D**E**F*"
  // 4 "************"
  // 5 "*G**H**I*"
  // 6 "************"
  private faceInnerLines(tokens9: string[]): string[] {
    // pad tokens to width 2 so columns line up (`U` -> `U `)
    const t = tokens9.map((tok) => (tok.length === 1 ? tok + " " : tok));
    return [
      "************",
      `*${t[0]}**${t[1]}**${t[2]}*`,
      "************",
      `*${t[3]}**${t[4]}**${t[5]}*`,
      "************",
      `*${t[6]}**${t[7]}**${t[8]}*`,
      "************",
    ];
  }

  // Print top or bottom band with indent and side pipes
  private printSingleBand(faceTokens: string[], indent: string) {
    const lines = this.faceInnerLines(faceTokens);
    for (let i = 0; i < lines.length; i++) {
      print(indent + "|" + lines[i] + "|");
    }
  }

  // Print one horizontal band of 4 faces (L F R B) joined by pipe
  private printMiddleBand(
    Ltokens: string[],
    Ftokens: string[],
    Rtokens: string[],
    Btokens: string[]
  ) {
    const Llines = this.faceInnerLines(Ltokens);
    const Flines = this.faceInnerLines(Ftokens);
    const Rlines = this.faceInnerLines(Rtokens);
    const Blines = this.faceInnerLines(Btokens);

    for (let i = 0; i < Llines.length; i++) {
      print(
        " " +
          Llines[i] +
          "|" +
          Flines[i] +
          "|" +
          Rlines[i] +
          "|" +
          Blines[i]
      );
    }
  }

  // Build token array ["U1".."U9"]
  private indexTokensFor(letter: string): string[] {
    const arr: string[] = [];
    for (let i = 1; i <= 9; i++) arr.push(letter + i.toString());
    return arr;
  }

  // Get tokens from classifiedFaces for specific face letter
  private classifiedTokensFor(
    classifiedFaces: Array<Array<string>>,
    faceLetter: string
  ): string[] {
    // find which capped face index corresponds to this letter per scan order
    const faceIdx = this.faceLettersOrder.indexOf(faceLetter);
    if (faceIdx < 0 || faceIdx >= classifiedFaces.length) {
      // fallback to blanks
      return ["  ", "  ", "  ", "  ", "  ", "  ", "  ", "  ", "  "];
    }
    // tokens are single letters
    return classifiedFaces[faceIdx].slice();
  }

  // Log index-reference net
  private logCubeNet_IndexReference() {
    print("[ScanController] Cube net (index reference):");
    const indent = "             ";

    // Top< U
    this.printSingleBand(this.indexTokensFor("U"), indent);

    // Middle, L F R B
    this.printMiddleBand(
      this.indexTokensFor("L"),
      this.indexTokensFor("F"),
      this.indexTokensFor("R"),
      this.indexTokensFor("B")
    );

    // Bottom, D
    this.printSingleBand(this.indexTokensFor("D"), indent);
  }

  // Log letter net
  private logCubeNet_Classified(classifiedFaces: Array<Array<string>>) {
    print("[ScanController] Cube net (classified letters):");
    const indent = "             ";

    // Top, U
    this.printSingleBand(this.classifiedTokensFor(classifiedFaces, "U"), indent);

    // Middle, L F R B
    this.printMiddleBand(
      this.classifiedTokensFor(classifiedFaces, "L"),
      this.classifiedTokensFor(classifiedFaces, "F"),
      this.classifiedTokensFor(classifiedFaces, "R"),
      this.classifiedTokensFor(classifiedFaces, "B")
    );

    // Bottom, D
    this.printSingleBand(this.classifiedTokensFor(classifiedFaces, "D"), indent);
  }


  // POST { cube: "<cubeState>" } and expect { solution: "..." }
  private async sendToLambdaAndShowSolution(cubeState: string) {
    if (!this.lambdaUrl || this.lambdaUrl.length === 0) {
      print("[ScanController] No lambdaUrl set.");
      if (this.ui && this.ui.showSolution) this.ui.showSolution("No lambda URL set.");
      return;
    }
    if (!this.internetModule) {
      print("[ScanController] No InternetModule assigned.");
      if (this.ui && this.ui.showSolution)
        this.ui.showSolution("No InternetModule assigned.");
      return;
    }

    const reqBody = JSON.stringify({ cube: cubeState });
    const request = new Request(this.lambdaUrl, {
      method: "POST",
      body: reqBody,
      headers: { "Content-Type": "application/json" },
    });

    print("[ScanController] Sending cube state to Lambda...");

    let response: any;
    try {
      response = await this.internetModule.fetch(request);
    } catch (err) {
      print("[ScanController] fetch() threw: " + err);
      if (this.ui && this.ui.showSolution) this.ui.showSolution("Network error.");
      return;
    }

    print("[ScanController] Lambda HTTP status: " + (response ? response.status : "no response"));

    if (!response || response.status !== 200) {
      let errText = "";
      try { errText = await response.text(); } catch (_) { errText = "(no body)"; }
      print("[ScanController] Lambda HTTP error body: " + errText);
      if (this.ui && this.ui.showSolution) this.ui.showSolution("Solver error");
      return;
    }

    let solutionMoves = "";
    try {
      const parsed = await response.json();
      solutionMoves = parsed && parsed.solution ? parsed.solution : "No 'solution' in response.";
    } catch (parseErr) {
      print("[ScanController] JSON parse failed, trying text(): " + parseErr);
      try { solutionMoves = await response.text(); } catch (_) { solutionMoves = "Could not read solver response."; }
    }

    print("[ScanController] Solution moves = " + solutionMoves);
    if (this.ui && this.ui.showSolution) this.ui.showSolution(solutionMoves);
  }
}
