import * as THREE from "three";

type MarkerInput =
  | {
      position: THREE.Vector3;
      color?: THREE.ColorRepresentation;
      radius?: number;
      texture?: THREE.Texture;
      label?: string;
    }
  | {
      position: [number, number, number];
      color?: THREE.ColorRepresentation;
      radius?: number;
      texture?: THREE.Texture;
      label?: string;
    };

/**
 * Simple world-space markers rendered with depth testing.
 */
export class WorldMarkers {
  private scene = new THREE.Scene();
  private markers: THREE.Sprite[] = [];
  private envMap: THREE.Texture | null = null;
  private defaultTexture: THREE.Texture;
  private labelSprite?: THREE.Sprite;
  private labelTarget?: THREE.Sprite;
  private labelFade = 0;
  private labelFadeTarget = 0;
  private lastRenderTime = performance.now();

  constructor() {
    this.defaultTexture = WorldMarkers.createDefaultTexture();
  }

  setMarkers(markers: MarkerInput[]) {
    this.clear();
    this.clearLabelImmediate();

    for (const marker of markers) {
      const pos =
        marker.position instanceof THREE.Vector3
          ? marker.position
          : new THREE.Vector3(...marker.position);

      const radius = marker.radius ?? 0.25;
      const texture = marker.texture ?? this.defaultTexture;
      const mat = new THREE.SpriteMaterial({
        map: texture,
        color: marker.color ?? "#ffffff",
        depthTest: true,
        depthWrite: true,
        transparent: true,
        alphaTest: 0.4, // discard low-alpha texels so depth doesn't become a big quad
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(pos);
      sprite.scale.setScalar(radius * 2); // approximate diameter
      sprite.userData = {
        label: marker.label ?? "",
        radius,
      };
      this.scene.add(sprite);
      this.markers.push(sprite);
    }
  }

  setEnvironmentMap(envMap: THREE.Texture | null | undefined) {
    this.envMap = envMap ?? null;
    this.scene.environment = this.envMap;
    for (const mesh of this.markers) {
      const mat = mesh.material;
      if ("envMap" in mat) {
        const m = mat as unknown as { envMap: THREE.Texture | null };
        m.envMap = this.envMap;
        if ("needsUpdate" in mat) {
          (mat as THREE.Material).needsUpdate = true;
        }
      }
    }
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    // update fade
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.1, (now - this.lastRenderTime) / 1000));
    this.lastRenderTime = now;

    const fadeSpeed = 8; // higher is faster
    const delta = this.labelFadeTarget - this.labelFade;
    if (Math.abs(delta) > 0.001) {
      this.labelFade += delta * Math.min(1, fadeSpeed * dt);
      this.labelFade = THREE.MathUtils.clamp(this.labelFade, 0, 1);
    }
    if (this.labelSprite && "opacity" in this.labelSprite.material) {
      this.labelSprite.material.opacity = this.labelFade;
    }

    const gl = renderer.getContext();
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    renderer.render(this.scene, camera);
  }

  getSprites(): readonly THREE.Sprite[] {
    return this.markers;
  }

  getPickableObjects(): readonly THREE.Object3D[] {
    return this.labelSprite ? [this.labelSprite, ...this.markers] : this.markers;
  }

  showLabelForSprite(sprite: THREE.Sprite) {
    this.showLabelForSpriteInternal(sprite, undefined);
  }

  private showLabelForSpriteInternal(sprite: THREE.Sprite, camera?: THREE.Camera) {
    const text: string = sprite.userData?.label ?? "";
    if (!text) {
      this.removeLabel();
      return;
    }

    this.removeLabel();

    const radius: number = sprite.userData?.radius ?? 0.25;
    const texture = WorldMarkers.createLabelTexture(text);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: true, // match marker depth behavior
      depthWrite: true,
      transparent: true,
      opacity: 0,
    });
    const label = new THREE.Sprite(mat);
    label.position.copy(sprite.position);
    label.position.y += radius * 1.2;

    const aspect =
      texture.image instanceof HTMLCanvasElement && texture.image.height > 0
        ? texture.image.width / texture.image.height
        : 2;

    const baseHeight = radius * 1.5;
    const distScale =
      camera instanceof THREE.Camera
        ? THREE.MathUtils.clamp(
            (camera.position.distanceTo(sprite.position) || 0.001) * 0.08,
            0.8,
            2.0
          )
        : 1;
    const height = baseHeight * distScale;
    label.scale.set(height * aspect, height, 1);

    this.labelSprite = label;
    this.labelTarget = sprite;
    sprite.visible = false; // hide marker button while text is visible
    this.labelFade = 0;
    this.labelFadeTarget = 1;
    this.scene.add(label);
  }

  toggleLabelForSprite(sprite: THREE.Sprite, camera?: THREE.Camera) {
    if (this.labelSprite && this.labelTarget === sprite) {
      this.removeLabel();
      return;
    }
    this.showLabelForSpriteInternal(sprite, camera);
  }

  removeLabel() {
    if (!this.labelSprite) return;
    this.clearLabelImmediate();
  }

  private clearLabelImmediate() {
    if (this.labelSprite) {
      this.scene.remove(this.labelSprite);
      const mat = this.labelSprite.material;
      if ("dispose" in mat && typeof mat.dispose === "function") mat.dispose();
      if (this.labelSprite.material.map) this.labelSprite.material.map.dispose();
      this.labelSprite = undefined;
    }
    if (this.labelTarget) {
      this.labelTarget.visible = true; // restore marker button
    }
    this.labelTarget = undefined;
    this.labelFade = 0;
    this.labelFadeTarget = 0;
  }

  dispose() {
    this.clear();
    this.defaultTexture.dispose();
    this.removeLabel();
  }

  private clear() {
    for (const mesh of this.markers) {
      this.scene.remove(mesh);
      if ("dispose" in mesh.material && typeof mesh.material.dispose === "function") {
        mesh.material.dispose();
      }
    }
    this.markers = [];
  }

  private static createDefaultTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create canvas context for marker texture.");

    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.05,
      size * 0.5,
      size * 0.5,
      size * 0.45
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,204,0,0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.5, size * 0.45, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; 
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private static createLabelTexture(text: string): THREE.Texture {
    const padding = 8;
    const fontSize = 16;
    const font = `${fontSize}px sans-serif`;
    const lineHeight = fontSize * 1.3;
    const closeSize = fontSize * 0.9;
    const closePadding = 6;
    const maxTextWidth = 220;
    const minTotalWidth = 100;
    const scale = 2; 

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create canvas context for label texture.");

    ctx.font = font;
    const { lines, maxLineWidth } = WorldMarkers.wrapText(ctx, text, maxTextWidth);

    const textBlockWidth = Math.max(maxLineWidth, 1);
    const textBlockHeight = lines.length * lineHeight;
    const closeBoxWidth = closeSize + closePadding * 2;

    const logicalWidth = Math.max(
      minTotalWidth,
      padding * 2 + textBlockWidth + closeBoxWidth
    );
    const logicalHeight = padding * 2 + textBlockHeight;

    canvas.width = Math.ceil(logicalWidth * scale);
    canvas.height = Math.ceil(logicalHeight * scale);

    const ctx2 = canvas.getContext("2d");
    if (!ctx2) throw new Error("Unable to create canvas context for label texture.");
    ctx2.scale(scale, scale);

    ctx2.font = font;
    ctx2.textBaseline = "top";
    ctx2.fillStyle = "rgba(20,24,32,0.8)";
    ctx2.strokeStyle = "rgba(255,255,255,0.15)";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.rect(1, 1, logicalWidth - 2, logicalHeight - 2);
    ctx2.fill();
    ctx2.stroke();

    ctx2.fillStyle = "#ffffff";
    lines.forEach((line, i) => {
      ctx2.fillText(line, padding, padding + i * lineHeight);
    });

    // Close "X"
    const closeX = logicalWidth - closePadding - closeSize;
    const closeY = padding + (textBlockHeight - closeSize) * 0.5;
    ctx2.strokeStyle = "rgba(255,255,255,0.8)";
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
    texture.needsUpdate = true;
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
