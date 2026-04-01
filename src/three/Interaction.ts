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
  private interestPointObject?: THREE.Object3D;
  private onInterestPointClick?: () => void;
  private enabled = true;

  constructor(opts: {
    dom: HTMLElement;
    camera: THREE.Camera;
    markers: WorldMarkers;
    moveThresholdPx?: number;
    onMarkerClick?: (index: number) => void;
    onPlaceClick?: () => void;
    interestPointObject?: THREE.Object3D;
    onInterestPointClick?: () => void;
  }) {
    this.dom = opts.dom;
    this.camera = opts.camera;
    this.markers = opts.markers;
    this.moveThresholdPx = opts.moveThresholdPx ?? 5;
    this.onMarkerClick = opts.onMarkerClick;
    this.onPlaceClick = opts.onPlaceClick;
    this.interestPointObject = opts.interestPointObject;
    this.onInterestPointClick = opts.onInterestPointClick;
    this.raycaster.params.Line = { threshold: 0.08 };

    this.dom.addEventListener("pointerdown", this.onDown);
    this.dom.addEventListener("pointermove", this.onMove);
    this.dom.addEventListener("pointerup", this.onUp);
    this.dom.addEventListener("pointercancel", this.onUp);
  }

  setEditorCallbacks(callbacks: {
    onMarkerClick?: (index: number) => void;
    onPlaceClick?: () => void;
    onInterestPointClick?: () => void;
  }) {
    this.onMarkerClick = callbacks.onMarkerClick;
    this.onPlaceClick = callbacks.onPlaceClick;
    this.onInterestPointClick = callbacks.onInterestPointClick;
  }

  setInterestPointObject(object: THREE.Object3D | undefined) {
    this.interestPointObject = object;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.isDown = false;
      this.downHit = null;
      this.movedTooMuch = false;
    }
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

    const pickables: THREE.Object3D[] = [...this.markers.getPickableObjects()];
    if (this.interestPointObject && this.onInterestPointClick) {
      pickables.push(this.interestPointObject);
    }

    const hits = this.raycaster.intersectObjects(pickables, true);
    if (!hits.length) return null;

    const hitObject = hits[0].object;
    if (this.interestPointObject && this.isDescendantOf(hitObject, this.interestPointObject)) {
      return this.interestPointObject;
    }

    return hitObject;
  }

  private onDown = (ev: PointerEvent) => {
    if (!this.enabled) return;
    if (ev.button !== 0) return;

    this.isDown = true;
    this.movedTooMuch = false;
    this.downX = ev.clientX;
    this.downY = ev.clientY;

    this.dom.setPointerCapture(ev.pointerId);
    this.downHit = this.raycastTopObject(ev);
  };

  private onMove = (ev: PointerEvent) => {
    if (!this.enabled) return;
    if (!this.isDown) return;

    const dx = ev.clientX - this.downX;
    const dy = ev.clientY - this.downY;
    const t = this.moveThresholdPx;
    if (dx * dx + dy * dy > t * t) this.movedTooMuch = true;
  };

  private onUp = (ev: PointerEvent) => {
    if (!this.enabled) return;
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

    if (this.interestPointObject && downHit === this.interestPointObject && this.onInterestPointClick) {
      this.onInterestPointClick?.();
      return;
    }

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

  private isDescendantOf(object: THREE.Object3D, root: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current === root) return true;
      current = current.parent;
    }
    return false;
  }
}
