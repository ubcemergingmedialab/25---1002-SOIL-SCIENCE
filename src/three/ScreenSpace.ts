// ScreenSpace.ts
import * as THREE from "three";

export class ScreenSpaceUI {
  private container: HTMLElement;
  private root: HTMLDivElement;
  private positionLabel: HTMLDivElement;
  private fpsLabel: HTMLDivElement;

  private playerWorldPos = new THREE.Vector3();
  private fps = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    console.log("ScreenSpaceUI created");
    // Make sure the container can host absolutely positioned children
    const style = getComputedStyle(container);
    if (style.position === "static" || !style.position) {
      container.style.position = "relative";
    }

    // Root overlay element 
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      alignItems: "flex-start",
      padding: "8px",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: "12px",
      color: "#ffffff",
    });

    //  world position lavel
    this.positionLabel = document.createElement("div");
    Object.assign(this.positionLabel.style, {
        background: "rgba(0, 0, 0, 0.5)", 
        padding: "4px 8px",
        borderRadius: "4px",
        whiteSpace: "pre",
    });
    this.positionLabel.textContent = "Player world: (0, 0, 0)";


    //fps label
    this.fpsLabel = document.createElement("div");
    Object.assign(this.fpsLabel.style, {
      background: "rgba(0, 0, 0, 0.5)",
      padding: "4px 8px",
      borderRadius: "4px",
      whiteSpace: "pre",
    });
    this.fpsLabel.textContent = "FPS: 0";

    this.root.appendChild(this.positionLabel);
    this.root.appendChild(this.fpsLabel);
    this.container.appendChild(this.root);
  }

  /**
   *  every frame
   */
  public setPlayerWorldPosition(pos: THREE.Vector3) {
    this.playerWorldPos.copy(pos);
  }

  public setFps(fps: number) {
    this.fps = fps;
  }

  /**
   * Same here
   */
  public update() {
    const { x, y, z } = this.playerWorldPos;
    this.positionLabel.textContent =
      `Player world: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
    this.fpsLabel.textContent = `FPS: ${this.fps.toFixed(1)}`;
  }

  public dispose() {
    if (this.root.parentElement === this.container) {
      this.container.removeChild(this.root);
    }
  }
}
