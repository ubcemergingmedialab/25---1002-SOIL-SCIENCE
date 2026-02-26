import * as THREE from "three";
import { WorldMarkers } from "./WorldMarkers";

export class MarkerPickingController {
  private readonly dom: HTMLElement;
  private readonly camera: THREE.Camera;
  private readonly markers: WorldMarkers;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private isDown = false;
  private downX = 0;
  private downY = 0;
  private downHit: THREE.Object3D | null = null;
  private movedTooMuch = false;
  private readonly moveThresholdPx: number;

  private onMarkerClick?: (index: number) => void;
  private onPlaceClick?: () => void;

  constructor(opts: {
    dom: HTMLElement;
    camera: THREE.Camera;
    markers: WorldMarkers;
    moveThresholdPx?: number;
    onMarkerClick?: (index: number) => void;
    onPlaceClick?: () => void;
  }) {
    this.dom = opts.dom;
    this.camera = opts.camera;
    this.markers = opts.markers;
    this.moveThresholdPx = opts.moveThresholdPx ?? 5;
    this.onMarkerClick = opts.onMarkerClick;
    this.onPlaceClick = opts.onPlaceClick;

    this.dom.addEventListener("pointerdown", this.onDown);
    this.dom.addEventListener("pointermove", this.onMove);
    this.dom.addEventListener("pointerup", this.onUp);
    this.dom.addEventListener("pointercancel", this.onUp);
  }

  setEditorCallbacks(callbacks: { onMarkerClick?: (index: number) => void; onPlaceClick?: () => void }) {
    this.onMarkerClick = callbacks.onMarkerClick;
    this.onPlaceClick = callbacks.onPlaceClick;
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointermove", this.onMove);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("pointercancel", this.onUp);
  }

  private raycastTopObject(ev: PointerEvent): THREE.Object3D | null {
    const rect = this.dom.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    this.pointerNdc.set(x, y);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hits = this.raycaster.intersectObjects(
      [...this.markers.getPickableObjects()],
      false
    );
    return hits.length ? hits[0].object : null;
  }

  private onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;

    this.isDown = true;
    this.movedTooMuch = false;
    this.downX = ev.clientX;
    this.downY = ev.clientY;

    this.dom.setPointerCapture(ev.pointerId);
    this.downHit = this.raycastTopObject(ev);
  };

  private onMove = (ev: PointerEvent) => {
    if (!this.isDown) return;

    const dx = ev.clientX - this.downX;
    const dy = ev.clientY - this.downY;
    const t = this.moveThresholdPx;
    if (dx * dx + dy * dy > t * t) this.movedTooMuch = true;
  };

  private onUp = (ev: PointerEvent) => {
    if (!this.isDown) return;
    this.isDown = false;

    try {
      this.dom.releasePointerCapture(ev.pointerId);
    } catch {;}

    if (this.movedTooMuch) {
      this.downHit = null;
      return;
    }

    const upHit = this.raycastTopObject(ev);
    const downHit = this.downHit;
    this.downHit = null;

    if (!downHit || !upHit || upHit !== downHit) {
      if (this.onPlaceClick && !downHit && !upHit) this.onPlaceClick();
      return;
    }

    const sprites = this.markers.getSprites();

    // label sprite (not in sprites) -> close
    if (!sprites.includes(downHit as THREE.Sprite)) {
      this.markers.removeLabel();
      return;
    }

    const markerIndex = sprites.indexOf(downHit as THREE.Sprite);
    if (this.onMarkerClick !== undefined) {
      this.onMarkerClick(markerIndex);
      return;
    }

    // marker sprite -> toggle 
    this.markers.toggleLabelForSprite(downHit as THREE.Sprite, this.camera);
  };
}
