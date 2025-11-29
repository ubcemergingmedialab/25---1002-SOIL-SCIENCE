import * as THREE from "three";

type MarkerInput =
  | { position: THREE.Vector3; color?: THREE.ColorRepresentation; radius?: number }
  | { position: [number, number, number]; color?: THREE.ColorRepresentation; radius?: number };

/**
 * Simple world-space markers rendered with depth testing
 * so they occlude with other 3D content.
 */
export class WorldMarkers {
  private scene = new THREE.Scene();
  private markers: THREE.Mesh[] = [];

  setMarkers(markers: MarkerInput[]) {
    this.clear();

    for (const marker of markers) {
      const pos =
        marker.position instanceof THREE.Vector3
          ? marker.position
          : new THREE.Vector3(...marker.position);

      const radius = marker.radius ?? 0.1;
      const geom = new THREE.SphereGeometry(radius, 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: marker.color ?? "#ffcc00",
        depthTest: true,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.markers.push(mesh);
    }
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    const gl = renderer.getContext();
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    renderer.render(this.scene, camera);
  }

  dispose() {
    this.clear();
  }

  private clear() {
    for (const mesh of this.markers) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if ("dispose" in mesh.material && typeof mesh.material.dispose === "function") {
        mesh.material.dispose();
      }
    }
    this.markers = [];
  }
}
