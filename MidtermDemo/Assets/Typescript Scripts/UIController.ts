// UIController.ts
// Shows messaging and panels

@component
export class UIController extends BaseScriptComponent {

  // Panel shown during placement
  @input
  instructionPanel: SceneObject;

  // Panel shown during scanning
  @input
  scanPanel: SceneObject;

  // SceneObject that holds Component.Text
  @input
  scanStepTextObj: SceneObject;

  // Floating label above pad
  @input
  padBillboardTextObj: SceneObject;

  // Main AR camera object for billboard pad label
  @input
  cameraObject: SceneObject;

  private faceNames: string[] = [
    "WHITE face up",
    "GREEN face up",
    "RED face up",
    "BLUE face up",
    "ORANGE face up",
    "YELLOW face up"
  ];

  onAwake() {
    // Start in placement mode UI
    this.showPlacementUI();

    // Keep billboard text facing camera
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
  }

  onUpdate() {
    this.billboardPadLabel();
  }

  // Rotate pad label to face camera
  private billboardPadLabel() {
    if (
      !this.padBillboardTextObj ||
      !this.cameraObject ||
      !this.padBillboardTextObj.enabled
    ) {
      return;
    }

    const labelXf = this.padBillboardTextObj.getTransform();
    const camXf = this.cameraObject.getTransform();

    if (!labelXf || !camXf) {
      return;
    }

    const camPos = camXf.getWorldPosition();
    const labelPos = labelXf.getWorldPosition();

    const toCam = camPos.sub(labelPos).normalize();
    const rot = quat.lookAt(toCam, vec3.up());
    labelXf.setWorldRotation(rot);
  }

  // Show placement instructions and hide scan UI
  public showPlacementUI() {
    if (this.instructionPanel) {
      this.instructionPanel.enabled = true;
    }
    if (this.scanPanel) {
      this.scanPanel.enabled = false;
    }

    if (this.padBillboardTextObj) {
      this.padBillboardTextObj.enabled = true;
    }
  }

  // Show scan panel, hide placement panel, update initial step text
  public showScanUI(stepIndex: number, totalSteps: number) {
    if (this.instructionPanel) {
      this.instructionPanel.enabled = false;
    }
    if (this.scanPanel) {
      this.scanPanel.enabled = true;
    }

    // When scanning starts hide floating pad label
    if (this.padBillboardTextObj) {
      this.padBillboardTextObj.enabled = false;
    }

    this.updateScanStep(stepIndex, totalSteps);
  }

  // Update Step x/6 instructions while scanning
  public updateScanStep(stepIndex: number, totalSteps: number) {
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

  // Tells user scanning is finished and solving is in progress
  public showDoneUI() {
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

  // Show move sequence
  public showSolution(solutionMoves: string) {
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
