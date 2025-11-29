//FlyControls.ts
import * as THREE from "three";

export class FlyControls {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  // Flycam
  private flyVel = new THREE.Vector3();
  private flySpeed = 3.0; // m/s
  private damping = 8.0;

  private moving = {
    f: false,
    b: false,
    l: false,
    r: false,
    u: false,
    d: false,
  };

  // Mouse-drag look
  private isDragging = false;
  private lastPointer = new THREE.Vector2();
  private yaw = 0; // around Y
  private pitch = 0; // around X
  private mouseSensitivity = 0.0025; // radians per pixel

  // Bound handlers so we can add/remove listeners
  private onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    console.log("FlyControls created");
    this.camera = camera;
    this.domElement = domElement;

    // Initialize yaw/pitch from camera’s quaternion
    const e = new THREE.Euler().setFromQuaternion(
      this.camera.quaternion,
      "YXZ"
    );
    this.pitch = e.x;
    this.yaw = e.y;

    // Input listeners
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.domElement.addEventListener("pointermove", this.onPointerMove);
    this.domElement.addEventListener("pointerup", this.onPointerUp);
    this.domElement.addEventListener("pointerleave", this.onPointerUp);
  }

  /**
   * Called every frame from ThreeApp.tick(dt)
   */
  update(dt: number) {
    // Damping
    const damp = Math.exp(-this.damping * dt);
    this.flyVel.multiplyScalar(damp);

    const speed = this.flySpeed;
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3()
      .crossVectors(forward, worldUp)
      .normalize();

    if (this.moving.f) this.flyVel.addScaledVector(forward, speed * dt);
    if (this.moving.b) this.flyVel.addScaledVector(forward, -speed * dt);
    if (this.moving.r) this.flyVel.addScaledVector(right, speed * dt);
    if (this.moving.l) this.flyVel.addScaledVector(right, -speed * dt);
    if (this.moving.u) this.flyVel.addScaledVector(worldUp, speed * dt);
    if (this.moving.d) this.flyVel.addScaledVector(worldUp, -speed * dt);

    this.camera.position.add(this.flyVel);
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.domElement.removeEventListener("pointermove", this.onPointerMove);
    this.domElement.removeEventListener("pointerup", this.onPointerUp);
    this.domElement.removeEventListener("pointerleave", this.onPointerUp);
  }

  // --- Pointer handlers ---

  private handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.isDragging = true;
    try {
      this.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    this.lastPointer.set(e.clientX, e.clientY);
    this.domElement.style.cursor = "grabbing";
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer.set(e.clientX, e.clientY);

    this.yaw -= dx * this.mouseSensitivity;
    this.pitch -= dy * this.mouseSensitivity;
    const limit = Math.PI / 2 - 0.001;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);

    const euler = new THREE.Euler(this.pitch, this.yaw, 0, "YXZ");
    this.camera.quaternion.setFromEuler(euler);
  }

  private handlePointerUp(e: PointerEvent) {
    if (!this.isDragging) return;
    this.isDragging = false;
    try {
      this.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    this.domElement.style.cursor = "grab";
  }

  // --- Keyboard handlers ---

  private handleKeyDown(e: KeyboardEvent) {
    if (e.code === "KeyW") this.moving.f = true;
    if (e.code === "KeyS") this.moving.b = true;
    if (e.code === "KeyA") this.moving.l = true;
    if (e.code === "KeyD") this.moving.r = true;
    if (e.code === "Space") this.moving.u = true;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.moving.d = true;
  }

  private handleKeyUp(e: KeyboardEvent) {
    if (e.code === "KeyW") this.moving.f = false;
    if (e.code === "KeyS") this.moving.b = false;
    if (e.code === "KeyA") this.moving.l = false;
    if (e.code === "KeyD") this.moving.r = false;
    if (e.code === "Space") this.moving.u = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight")
      this.moving.d = false;
  }
}
