import * as THREE from "three";
import { normalizeMarkerLabel, type MarkerLabel } from "../types/markerLabel";

type MarkerPosition = THREE.Vector3 | [number, number, number];

export type MarkerInput = {
  position: MarkerPosition;
  color?: THREE.ColorRepresentation;
  radius?: number;
  texture?: THREE.Texture;
  label?: MarkerLabel;
};

/**
 * wrld-space markers rendered with depth testing.
 */
export class WorldMarkers {
  private readonly scene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private sprites: THREE.Sprite[] = [];
  private readonly defaultTexture: THREE.Texture;

  private labelSprite?: THREE.Sprite;
  private labelTarget?: THREE.Sprite;

  private placementPreviewSprite?: THREE.Sprite;

  constructor() {
    this.defaultTexture = WorldMarkers.createDefaultTexture();
  }

  setMarkers(markers: MarkerInput[], previewMarker?: MarkerInput | null, selectedIndex?: number | null) {
    this.clearMarkers();
    this.clearLabel();
    if (this.placementPreviewSprite) {
      this.scene.remove(this.placementPreviewSprite);
      this.placementPreviewSprite.material.dispose();
      this.placementPreviewSprite = undefined;
    }

    const list = previewMarker ? [...markers, previewMarker] : markers;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const isPreview = previewMarker != null && i === list.length - 1;
      const pos = WorldMarkers.toVector3(m.position);
      const radius = m.radius ?? 0.25;
      const texture = m.texture ?? this.defaultTexture;
      const isSelected = !isPreview && selectedIndex != null && i === selectedIndex;
      const color = isSelected ? "#3b82f6" : (m.color ?? "#ffffff");
      const sprite = WorldMarkers.createMarkerSprite(pos, radius, texture, color);
      if (isPreview) {
        this.placementPreviewSprite = sprite;
        this.placementPreviewSprite.userData = { isPlacementPreview: true };
      } else {
        sprite.userData = { label: normalizeMarkerLabel(m.label), radius };
        this.sprites.push(sprite);
      }
      this.scene.add(sprite);
    }
  }

  /** Update the placement preview position (called each frame when in place mode). */
  setPlacementPreviewPosition(position: THREE.Vector3 | [number, number, number]) {
    if (!this.placementPreviewSprite) return;
    this.placementPreviewSprite.position.copy(WorldMarkers.toVector3(position));
  }

  // might use this later
  setEnvironmentMap(envMap: THREE.Texture | null | undefined) {
    this.scene.environment = envMap ?? null;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    renderer.render(this.scene, camera);
  }

  renderOverlay(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.labelSprite) return;
    renderer.render(this.overlayScene, camera);
  }

  getSprites(): readonly THREE.Sprite[] {
    return this.sprites;
  }

  getSpriteAt(index: number): THREE.Sprite | null {
    return this.sprites[index] ?? null;
  }

  getPickableObjects(): readonly THREE.Object3D[] {
    const list = this.labelSprite ? [this.labelSprite, ...this.sprites] : [...this.sprites];
    return list;
  }

  toggleLabelForSprite(sprite: THREE.Sprite, camera?: THREE.Camera) {
    if (this.labelSprite && this.labelTarget === sprite) {
      this.clearLabel();
      return;
    }
    this.showLabel(sprite, camera);
  }

  showLabelForSprite(sprite: THREE.Sprite, camera?: THREE.Camera) {
    this.showLabel(sprite, camera);
  }

  removeLabel() {
    this.clearLabel();
  }

  dispose() {
    this.clearLabel();
    if (this.placementPreviewSprite) {
      this.scene.remove(this.placementPreviewSprite);
      this.placementPreviewSprite.material.dispose();
      this.placementPreviewSprite = undefined;
    }
    this.clearMarkers();
    this.defaultTexture.dispose();
  }

  // --------------------
  // Internals
  // --------------------

  private showLabel(sprite: THREE.Sprite, camera?: THREE.Camera) {
    const marker = {
      label: normalizeMarkerLabel(sprite.userData?.label),
      radius: sprite.userData?.radius,
    };
    const title = marker.label?.[0] ?? "";
    const description = marker.label?.[1] ?? "";
    if (!title && !description) {
      this.clearLabel();
      return;
    }

    this.clearLabel();

    const radius: number = marker.radius ?? 0.25;
    const texture = WorldMarkers.createLabelTexture(title, description);

    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });

    const label = new THREE.Sprite(mat);
    label.position.copy(sprite.position);

    const img = texture.image;
    const pixelWidth = img?.width ?? 200;
    const pixelHeight = img?.height ?? 100;
    const aspect = pixelHeight > 0 ? pixelWidth / pixelHeight : 2;

    // Size the box by content
    const scale = 2;
    const lineHeightLogical = 16 * 1.3;
    const logicalHeight = pixelHeight / scale;
    const numLines = Math.max(1, (logicalHeight - 16) / lineHeightLogical);
    const baseHeightPerLine = radius * 0.65;
    const distScale =
      camera instanceof THREE.Camera
        ? THREE.MathUtils.clamp(
            (camera.position.distanceTo(sprite.position) || 0.001) * 0.08,
            0.8,
            2.0
          )
        : 1;
    const height = numLines * baseHeightPerLine * distScale;
    label.scale.set(height * aspect, height, 1);

    this.labelSprite = label;
    this.labelTarget = sprite;

    sprite.visible = false;
    this.overlayScene.add(label);
  }

  private clearLabel() {
    if (this.labelSprite) {
      this.overlayScene.remove(this.labelSprite);
      const mat = this.labelSprite.material;
      mat.map?.dispose();
      mat.dispose();
      this.labelSprite = undefined;
    }

    if (this.labelTarget) {
      this.labelTarget.visible = true;
      this.labelTarget = undefined;
    }
  }

  private clearMarkers() {
    for (const s of this.sprites) {
      this.scene.remove(s);
      s.material.dispose();
      //NOT disposing s.material.map since textures may be shared or user-owned
    }
    this.sprites = [];
  }

  private static toVector3(pos: MarkerPosition): THREE.Vector3 {
    return Array.isArray(pos) ? new THREE.Vector3(pos[0], pos[1], pos[2]) : pos;
  }

  /** configured like a real marker. */
  private static createMarkerSprite(
    position: THREE.Vector3,
    radius: number,
    texture: THREE.Texture,
    color: THREE.ColorRepresentation = "#ffffff"
  ): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: texture,
      color,
      depthTest: true,
      depthWrite: true,
      transparent: true,
      alphaTest: 0.4,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.scale.setScalar(radius * 2);
    return sprite;
  }

  private static createDefaultTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create canvas context for marker texture.");

    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.5, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
    // Slight edge 
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private static createLabelTexture(title: string, description: string): THREE.Texture {
    const padding = 12;
    const titleFontSize = 16;
    const descriptionFontSize = 14;
    const titleFont = `600 ${titleFontSize}px sans-serif`;
    const descriptionFont = `${descriptionFontSize}px sans-serif`;
    const titleLineHeight = titleFontSize * 1.3;
    const descriptionLineHeight = descriptionFontSize * 1.45;
    const closeSize = titleFontSize * 0.9;
    const maxTextWidth = 240;
    const minTotalWidth = 180;
    const scale = 2;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create canvas context for label texture.");

    ctx.font = titleFont;
    const titleBlock = WorldMarkers.wrapText(ctx, title, maxTextWidth - closeSize);
    ctx.font = descriptionFont;
    const descriptionBlock = WorldMarkers.wrapText(ctx, description, maxTextWidth);

    const contentWidth = Math.max(titleBlock.maxLineWidth + closeSize + padding, descriptionBlock.maxLineWidth, 1);
    const logicalWidth = Math.max(minTotalWidth, padding * 2 + contentWidth);
    const headerHeight = padding * 2 + Math.max(titleBlock.lines.length, 1) * titleLineHeight;
    const bodyHeight =
      descriptionBlock.lines.length > 0
        ? padding * 2 + descriptionBlock.lines.length * descriptionLineHeight
        : padding * 2 + descriptionLineHeight;
    const logicalHeight = headerHeight + bodyHeight;

    canvas.width = Math.ceil(logicalWidth * scale);
    canvas.height = Math.ceil(logicalHeight * scale);

    const ctx2 = canvas.getContext("2d");
    if (!ctx2) throw new Error("Unable to create canvas context for label texture.");

    ctx2.scale(scale, scale);
    ctx2.textBaseline = "top";

    // Modal-like container.
    ctx2.fillStyle = "rgba(255,255,255,0.98)";
    ctx2.strokeStyle = "rgba(0,0,0,0.22)";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.rect(1, 1, logicalWidth - 2, logicalHeight - 2);
    ctx2.fill();
    ctx2.stroke();

    ctx2.strokeStyle = "rgba(0,0,0,0.14)";
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.moveTo(1, headerHeight);
    ctx2.lineTo(logicalWidth - 1, headerHeight);
    ctx2.stroke();

    // Header title.
    ctx2.font = titleFont;
    ctx2.fillStyle = "#212529";
    titleBlock.lines.forEach((line, i) => {
      ctx2.fillText(line, padding, padding + i * titleLineHeight);
    });

    // Body description.
    ctx2.font = descriptionFont;
    ctx2.fillStyle = "#343a40";
    const bodyLines = descriptionBlock.lines.length > 0 ? descriptionBlock.lines : [""];
    bodyLines.forEach((line, i) => {
      ctx2.fillText(line, padding, headerHeight + padding + i * descriptionLineHeight);
    });

    // Close X
    const closeX = logicalWidth - padding - closeSize;
    const closeY = padding + (headerHeight - padding * 2 - closeSize) * 0.5;
    ctx2.strokeStyle = "rgba(33,37,41,0.7)";
    ctx2.lineWidth = 2.5;
    ctx2.beginPath();
    ctx2.moveTo(closeX, closeY);
    ctx2.lineTo(closeX + closeSize, closeY + closeSize);
    ctx2.moveTo(closeX + closeSize, closeY);
    ctx2.lineTo(closeX, closeY + closeSize);
    ctx2.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private static wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
  ): { lines: string[]; maxLineWidth: number } {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    let widest = 0;

    for (const word of words) {
      const tentative = current ? `${current} ${word}` : word;
      const width = ctx.measureText(tentative).width;

      if (width <= maxWidth || !current) {
        current = tentative;
        widest = Math.max(widest, width);
      } else {
        lines.push(current);
        current = word;
        widest = Math.max(widest, ctx.measureText(word).width);
      }
    }

    if (current) lines.push(current);
    return { lines, maxLineWidth: widest };
  }
}
