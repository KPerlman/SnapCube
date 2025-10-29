// UIController.ts
// Owns UI text and floating label above pad

@component
export class UIController extends BaseScriptComponent {
  // During placement
  @input
  instructionPanel: SceneObject;

  // During scanning
  @input
  scanPanel: SceneObject;

  // The Text component under scanPanel
  @input
  scanStepTextObj: SceneObject;

  // Floating text above pad
  @input
  padBillboardTextObj: SceneObject;

  // Main AR camera object for billboarding world label
  @input
  cameraObject: SceneObject;

  // Faces to be scanned
  private faceNames: string[] = [
    "WHITE face up",
    "GREEN face up",
    "RED face up",
    "BLUE face up",
    "ORANGE face up",
    "YELLOW face up"
  ];

  onAwake() {
    this.showPlacementUI();

    // Keep billboard facing camera
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
  }

  onUpdate() {
    this.billboardPadLabel();
  }

  // Rotate pad label to face camera
  private billboardPadLabel() {
    if (!this.padBillboardTextObj || !this.cameraObject) {
      return;
    }

    const labelXf = this.padBillboardTextObj.getTransform();
    const camXf = this.cameraObject.getTransform();

    const camPos = camXf.getWorldPosition();
    const labelPos = labelXf.getWorldPosition();

    const toCam = camPos.sub(labelPos).normalize();
    const rot = quat.lookAt(toCam, vec3.up());
    labelXf.setWorldRotation(rot);
  }

  // Show placement instructions and hide scan UI
  showPlacementUI() {
    if (this.instructionPanel) {
      this.instructionPanel.enabled = true;
    }
    if (this.scanPanel) {
      this.scanPanel.enabled = false;
    }
  }

  // Show scan panel, hide placement panel, set initial step text
  showScanUI(stepIndex: number, totalSteps: number) {
    if (this.instructionPanel) {
      this.instructionPanel.enabled = false;
    }
    if (this.scanPanel) {
      this.scanPanel.enabled = true;
    }
    this.updateScanStep(stepIndex, totalSteps);
  }

  // Update "Step x/6" text
  updateScanStep(stepIndex: number, totalSteps: number) {
    if (!this.scanStepTextObj) {
      return;
    }
    const textComp = this.scanStepTextObj.getComponent(
      "Component.Text"
    ) as any;
    if (!textComp) {
      return;
    }

    const faceLabel =
      this.faceNames[stepIndex] || "next face up";

    textComp.text =
      "Step " +
      (stepIndex + 1) +
      "/" +
      totalSteps +
      ":\nPut " +
      faceLabel +
      " on the pad\nand pinch to capture";
  }

  // State that scanning is complete, solving in progress
  showScanComplete() {
    if (!this.scanStepTextObj) {
      return;
    }
    const textComp = this.scanStepTextObj.getComponent(
      "Component.Text"
    ) as any;
    if (!textComp) {
      return;
    }
    textComp.text = "All faces captured.\nSolving cube...";
  }

  // Show solution from AWS
  showSolution(solutionMoves: string) {
    if (!this.scanStepTextObj) {
      return;
    }
    const textComp = this.scanStepTextObj.getComponent(
      "Component.Text"
    ) as any;
    if (!textComp) {
      return;
    }
    textComp.text = "Solution:\n" + solutionMoves;
  }
}
