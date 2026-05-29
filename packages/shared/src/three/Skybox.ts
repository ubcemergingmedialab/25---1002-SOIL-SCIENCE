import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import skyboxVertexShader from "./shaders/skybox.vs?raw";
import skyboxFragmentShader from "./shaders/skybox.fs?raw";

/**
 * Lightweight skybox renderer that consumes an equirectangular map.
 * No IBL/environment map hookup for now
 */
export class Skybox {
  private scene = new THREE.Scene();
  private sphere?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private material?: THREE.ShaderMaterial;
  private texture?: THREE.Texture;
  private loader = new THREE.TextureLoader();
  private hdrLoader = new HDRLoader().setDataType(THREE.HalfFloatType);
  private loadToken = 0;
  private destroyed = false;

  /**
   * Load an equirectangular texture and prepare it for rendering as a sky.
   * Passing an empty string clears any existing skybox.
   */
  async setEquirectangular(url: string | null | undefined) {
    if (this.destroyed) return;

    if (!url) {
      this.clearTexture();
      return;
    }

    const token = ++this.loadToken;
    const isHdr = /\.hdr$/i.test(url);
    try {
      const tex = isHdr
        ? await this.hdrLoader.loadAsync(url)
        : await this.loader.loadAsync(url);
      if (this.destroyed || token !== this.loadToken) {
        tex.dispose();
        return;
      }

      this.applyTexture(tex, isHdr);
    } catch (err) {
      if (this.destroyed || token !== this.loadToken) return;
      console.error("Failed to load skybox texture:", err);
    }
  }

  /**
   * Get the loaded environment map (equirectangular). Useful for IBL on other objects.
   */
  getEnvironmentMap(): THREE.Texture | null {
    return this.texture ?? null;
  }

  /**
   * Render the skybox as a background. Call once per frame before other content.
   */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    if (this.destroyed || !this.sphere) return;

    // Keep the sky centered on the camera so it appears infinitely far away.
    this.sphere.position.copy(camera.position);
    renderer.render(this.scene, camera);
  }

  dispose() {
    this.destroyed = true;
    this.loadToken++;
    this.clearTexture();
    if (this.sphere) {
      this.scene.remove(this.sphere);
      this.sphere.geometry.dispose();
      this.sphere.material.dispose();
      this.sphere = undefined;
    }
  }

  private applyTexture(tex: THREE.Texture, isHdr: boolean) {
    this.clearTexture();
    this.texture = tex;

    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.flipY = true;
    const linearSRGB =
      (THREE as unknown as { LinearSRGBColorSpace?: THREE.ColorSpace }).LinearSRGBColorSpace ??
      THREE.SRGBColorSpace;
    tex.colorSpace = isHdr ? linearSRGB : THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    if (!this.sphere) {
      const geom = new THREE.SphereGeometry(1, 64, 48);
      const mat = this.createMaterial();
      this.sphere = new THREE.Mesh(geom, mat);
      this.sphere.frustumCulled = false;
      this.scene.add(this.sphere);
    }

    if (this.material) {
      this.material.uniforms.map.value = tex;
      this.material.needsUpdate = true;
    }
  }

  private clearTexture() {
    if (this.texture) {
      this.texture.dispose();
      this.texture = undefined;
    }
    if (this.material) {
      this.material.uniforms.map.value = null;
      this.material.needsUpdate = true;
    }
  }

  private createMaterial() {
    const uniforms = {
      map: { value: null as THREE.Texture | null },
      fadeStart: { value: -0.4 }, // y-direction threshold where sky starts to appear
      fadeEnd: { value: -0.2 }, // y-direction where sky is fully visible
    };

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: skyboxVertexShader,
      fragmentShader: skyboxFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });

    this.material = mat;
    return mat;
  }
}
