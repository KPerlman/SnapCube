// PlacementController.ts
// Moves pad on real surfaces
// On pinch-release, lock pad in place, starts scanning

import { UIController } from "./UIController";
import { ScanController } from "./ScanController";

const WorldQueryModule = require('LensStudio:WorldQueryModule');
const SIK = require('SpectaclesInteractionKit.lspkg/SIK').SIK;
const InteractorModule =
  require('SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor');
const InteractorTriggerType = InteractorModule.InteractorTriggerType;

const EPSILON = 0.01;

@component
export class PlacementController extends BaseScriptComponent {

  // Root of the movable pad, including floating text obj
  @input
  padObject: SceneObject;

  // World camera
  @input
  cameraObject: SceneObject;

  // WorldQuery smoothing flag
  @input
  filterEnabled: boolean;

  // How far to push the pad into surface (just for tuning)
  @input
  surfaceOffset: number = 0.005;

  // Other controllers
  @input
  ui: UIController;

  @input
  scan: ScanController;


  private hitTestSession: any;
  private padXf: Transform;

  private padLocked: boolean = false;

  private lastPos: vec3 | null = null;
  private lastRot: quat | null = null;

  onAwake() {
    if (!this.padObject) {
      print("[PlacementController] ERROR: padObject not assigned.");
      return;
    }

    // Create hit test session for world placement
    this.hitTestSession = this.createHitTestSession(this.filterEnabled);
    // Cache transform for fast updates
    this.padXf = this.padObject.getTransform();
    // Initially not locked
    this.padLocked = false;
    // Show placement UI, scan UI hidden
    if (this.ui) {
      this.ui.showPlacementUI();
    }
    // Hide pad until valid surface hit
    this.padObject.enabled = false;
    // Tick each frame
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
  }

  private createHitTestSession(filterEnabled: boolean) {
    const OptionsCtor = WorldQueryModule.HitTestSessionOptions;
    if (OptionsCtor && OptionsCtor.create) {
      const opts = OptionsCtor.create();
      opts.filter = !!filterEnabled;
      return WorldQueryModule.createHitTestSessionWithOptions(opts);
    }

    if (WorldQueryModule.createHitTestSession) {
      return WorldQueryModule.createHitTestSession();
    }

    print("[PlacementController] Could not create WorldQuery HitTest session.");
    return null;
  }

  // Grab user's main interactor
  private getPrimaryInteractor() {
    // Prefer targeting interactor
    const targeting = SIK.InteractionManager.getTargetingInteractors();
    if (targeting && targeting.length > 0) {
      return targeting[0];
    }

    // Fallback to other interactor
    if (SIK.InteractionManager.getInteractors) {
      const all = SIK.InteractionManager.getInteractors();
      if (all && all.length > 0) {
        return all[0];
      }
    }

    return null;
  }

  // Stick pad to hit surface, oriented to surface's normal
  private stickPadToSurface(worldPos: vec3, worldNormal: vec3) {
    const n = worldNormal.normalize();

    // Pick forward dir
    let forwardDir: vec3;
    if (1 - Math.abs(n.dot(vec3.up())) < EPSILON) {
      // ~horizontal, keep forward as world forward
      forwardDir = vec3.forward();
    } else {
      // angled or vertical, forward = normal x up
      forwardDir = n.cross(vec3.up());
    }

    const rot = quat.lookAt(forwardDir, n);

    // Do offset
    const adjustedPos = worldPos.add(
      n.uniformScale(-this.surfaceOffset)
    );

    this.padXf.setWorldPosition(adjustedPos);
    this.padXf.setWorldRotation(rot);

    // Remember pose just in case
    this.lastPos = adjustedPos;
    this.lastRot = rot;
  }

  // Called when pinching to confirm placement
  private finalizePlacement() {
    if (this.padLocked) {
      return;
    }
    this.padLocked = true;

    print("[PlacementController] Pad locked. Starting scan...");

    // Put UI in scan mode
    if (this.ui) {
      this.ui.showScanUI(0, 6);
    }

    // Tell ScanController to start watching pinch-release for caps
    if (this.scan) {
      this.scan.beginScan();
    }
  }

  private handleHitTestResult(
    result: any,
    prevTrig: number,
    curTrig: number
  ) {
    // If no hit or already locked, don't move pad anymore
    if (!result || this.padLocked) {
      if (!this.padLocked) {
        // Not locked yet but no good hit, so hide preview
        this.padObject.enabled = false;
      }
      return;
    }

    // Have valid hit and not locked yet, show pad and update pose
    this.padObject.enabled = true;
    this.stickPadToSurface(result.position, result.normal);

    // Detect pinch-release edge to lock, "previous trigger != None && current trigger == None"
    if (
      prevTrig !== InteractorTriggerType.None &&
      curTrig === InteractorTriggerType.None
    ) {
      this.finalizePlacement();
    }
  }

  onUpdate() {
    // If locked, bail - don't move pad anymore
    if (this.padLocked) {
      return;
    }

    const interactor = this.getPrimaryInteractor();
    if (!interactor) {
      // No hand interactor, hide preview
      this.padObject.enabled = false;
      return;
    }

    // Only run hitTest when hand interactor is actually targeting
    const canTarget =
      (interactor.isActive && interactor.isActive()) &&
      (interactor.isTargeting && interactor.isTargeting());

    if (!canTarget) {
      this.padObject.enabled = false;
      return;
    }

    // Build ray from interactor
    const rayStart = new vec3(
      interactor.startPoint.x,
      interactor.startPoint.y,
      interactor.startPoint.z
    );
    const rayEnd = new vec3(
      interactor.endPoint.x,
      interactor.endPoint.y,
      interactor.endPoint.z
    );

    if (!this.hitTestSession) {
      this.padObject.enabled = false;
      return;
    }

    // Ask WorldQuery for hit
    this.hitTestSession.hitTest(
      rayStart,
      rayEnd,
      (res: any) => {
        this.handleHitTestResult(
          res,
          interactor.previousTrigger,
          interactor.currentTrigger
        );
      }
    );
  }
}
