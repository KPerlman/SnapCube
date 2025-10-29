// ScanController.ts
// Handles scanning each cube face after placement is locked
// Watches pinching to capture faces
// Calls AWS solver and shows solution

import { UIController } from "./UIController";

const SIK = require('SpectaclesInteractionKit.lspkg/SIK').SIK;
const InteractorModule =
  require('SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor');
const InteractorTriggerType = InteractorModule.InteractorTriggerType;

const InternetModule = require("LensStudio:InternetModule");

@component
export class ScanController extends BaseScriptComponent {
  // For updating instructions
  @input
  ui: UIController;

  // AWS Lambda URL
  @input
  solverUrl: string;

  private totalFaces: number = 6;
  private currentFaceIndex: number = 0;

  // Require an open hand before capturing to avoid instant caps
  private scanArmed: boolean = false;
  private scanningActive: boolean = false;

  // this will become arrays of 9 colors per face
  private capturedFaces: string[] = [];

  onAwake() {
    this.scanningActive = false;
    this.scanArmed = false;
    this.currentFaceIndex = 0;
    this.capturedFaces = [];

    // Poll hand trigger
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
  }

  // Called by PlacementController.finalizePlacement()
  beginScan() {
    this.scanningActive = true;
    this.scanArmed = false;
    this.currentFaceIndex = 0;
    this.capturedFaces = [];

    if (this.ui) {
      this.ui.showScanUI(this.currentFaceIndex, this.totalFaces);
    }

    print(
      "[ScanController] Scan started. Waiting for face 1/" +
        this.totalFaces
    );
  }

  // Choose active interactor
  private getPrimaryInteractor() {
    // Prefer actively targeting interactors first
    const targeting = SIK.InteractionManager.getTargetingInteractors();
    if (targeting && targeting.length > 0) {
      return targeting[0];
    }

    // Just get first interactor as fallback
    if (SIK.InteractionManager.getInteractors) {
      const all = SIK.InteractionManager.getInteractors();
      if (all && all.length > 0) {
        return all[0];
      }
    }

    return null;
  }

  // Called when user pinches while scanning
  private captureThisFace() {
    // TODO: sample global.captureTexRef 3x3, classify sticker colors
    // For now just records a label to know it triggered
    const label = "FACE_" + (this.currentFaceIndex + 1);
    this.capturedFaces.push(label);

    print(
      "[ScanController] Captured face " +
        (this.currentFaceIndex + 1) +
        "/" +
        this.totalFaces +
        " -> " +
        label
    );

    this.currentFaceIndex++;

    // If last face,
    if (this.currentFaceIndex >= this.totalFaces) {
      this.finishAllScanning();
      return;
    }

    // Otherwise move to next instruction
    this.scanArmed = false; // Force open hand again

    if (this.ui) {
      this.ui.updateScanStep(
        this.currentFaceIndex,
        this.totalFaces
      );
    }
  }

  // After last face, update UI, send request, show solution
  private finishAllScanning() {
    this.scanningActive = false;

    print("[ScanController] All faces captured. Preparing to solve.");

    if (this.ui) {
      this.ui.showScanComplete();
    }

    // TODO: build real cube string from captured colors
    // For now just sends hardcoded string
    const cubeString =
      "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

    this.solveOnLambda(cubeString);
  }

  // POST to Lambda
  private solveOnLambda(cubeString: string) {
    if (!this.solverUrl) {
      print("[ScanController] Missing solverUrl.");
      return;
    }

    const request = new Request(this.solverUrl, {
      method: "POST",
      body: JSON.stringify({ cube: cubeString }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const self = this;

    (async function () {
      print("[ScanController] Requesting cube solution from AWS...");

      let response = await InternetModule.fetch(request);

      if (response.status != 200) {
        print("[ScanController] Lambda error status: " + response.status);
        return;
      }

      let json = await response.json();

      if (json && json.solution) {
        print("[ScanController] Lambda returned: " + json.solution);

        if (self.ui) {
          self.ui.showSolution(json.solution);
        }
      } else {
        print("[ScanController] Lambda response missing 'solution'.");
      }
    })();
  }

  onUpdate() {
    if (!this.scanningActive) {
      return;
    }

    const interactor = this.getPrimaryInteractor();
    if (!interactor) {
      return;
    }

    const prevTrig = interactor.previousTrigger;
    const curTrig = interactor.currentTrigger;

    // Don't allow capture until hand is open
    if (!this.scanArmed) {
      if (
        prevTrig === InteractorTriggerType.None &&
        curTrig === InteractorTriggerType.None
      ) {
        this.scanArmed = true;
      }
      return;
    }

    // When armed watch for pinch release, prev != None && cur == None
    if (
        prevTrig !== InteractorTriggerType.None &&
        curTrig === InteractorTriggerType.None
    ) {
      this.captureThisFace();
    }
  }
}
