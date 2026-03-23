// ScreenSpace.ts
import * as THREE from "three";

export type PerformancePreset = "low" | "medium" | "high";
export type ControlMode = "fly" | "orbit";

export interface PerformanceSettings {
  preset: PerformancePreset;
  pixelRatio: number;
  // Higher threshold = more splats culled = faster but more holes
  // 0 = keep all splats, 20+ = aggressive culling
  splatAlphaRemovalThreshold: number;
}

export const PERFORMANCE_PRESETS: Record<PerformancePreset, PerformanceSettings> = {
  // Low: aggressive culling, reduced resolution
  low: { preset: "low", pixelRatio: 0.5, splatAlphaRemovalThreshold: 15 },
  // Medium: moderate culling, full resolution
  medium: { preset: "medium", pixelRatio: 1.0, splatAlphaRemovalThreshold: 5 },
  // High: minimal culling, full resolution
  high: { preset: "high", pixelRatio: 1.0, splatAlphaRemovalThreshold: 1 },
};

export class ScreenSpaceUI {
  private container: HTMLElement;
  private root: HTMLDivElement;
  private topStack: HTMLDivElement;
  private bottomRow: HTMLDivElement;
  private technicalWrap: HTMLDivElement;
  private positionLabel: HTMLDivElement;
  private fpsLabel: HTMLDivElement;
  private clientTypeLabel: HTMLDivElement;
  private gpuLabel: HTMLDivElement;
  private speedWrap: HTMLDivElement;
  private speedValue: HTMLSpanElement;
  private perfSelect: HTMLSelectElement;
  private controlsHint: HTMLDivElement;
  private controlModeWrap: HTMLDivElement;
  private flyModeBtn: HTMLButtonElement;
  private orbitModeBtn: HTMLButtonElement;
  private onSpeedChange?: (value: number) => void;
  private onPerformanceChange?: (settings: PerformanceSettings) => void;
  private onControlModeChange?: (mode: ControlMode) => void;

  private playerWorldPos = new THREE.Vector3();
  private fps = 0;
  private clientType = "Unknown";
  private gpuRenderer = "Unknown";

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
      padding: "8px",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: "12px",
      color: "#ffffff",
    });

    this.topStack = document.createElement("div");
    Object.assign(this.topStack.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      alignItems: "flex-start",
    });

    this.bottomRow = document.createElement("div");
    Object.assign(this.bottomRow.style, {
      marginTop: "auto",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: "12px",
      width: "100%",
    });

    // Performance preset selector
    this.controlModeWrap = document.createElement("div");
    Object.assign(this.controlModeWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 8px",
      background: "rgba(0, 0, 0, 0.5)",
      borderRadius: "4px",
      pointerEvents: "auto",
    });

    const modeLabel = document.createElement("span");
    modeLabel.textContent = "Controls";

    this.flyModeBtn = document.createElement("button");
    this.flyModeBtn.type = "button";
    this.flyModeBtn.textContent = "Fly";
    this.styleModeButton(this.flyModeBtn);

    this.orbitModeBtn = document.createElement("button");
    this.orbitModeBtn.type = "button";
    this.orbitModeBtn.textContent = "Orbit";
    this.styleModeButton(this.orbitModeBtn);

    this.flyModeBtn.addEventListener("click", () => this.onControlModeChange?.("fly"));
    this.orbitModeBtn.addEventListener("click", () => this.onControlModeChange?.("orbit"));

    this.controlModeWrap.appendChild(modeLabel);
    this.controlModeWrap.appendChild(this.flyModeBtn);
    this.controlModeWrap.appendChild(this.orbitModeBtn);

    const perfWrap = document.createElement("div");
    Object.assign(perfWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 8px",
      background: "rgba(0, 0, 0, 0.5)",
      borderRadius: "4px",
      pointerEvents: "auto",
    });

    const perfLabel = document.createElement("span");
    perfLabel.textContent = "Quality";

    this.perfSelect = document.createElement("select");
    Object.assign(this.perfSelect.style, {
      background: "rgba(255, 255, 255, 0.1)",
      border: "1px solid rgba(255, 255, 255, 0.2)",
      borderRadius: "3px",
      color: "#fff",
      padding: "2px 6px",
      fontSize: "12px",
      cursor: "pointer",
    });

    const presetLabels: Record<PerformancePreset, string> = {
      low: "Low",
      medium: "Medium", 
      high: "High",
    };

    for (const [key, label] of Object.entries(presetLabels)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      option.style.background = "#1a1a2e";
      option.style.color = "#fff";
      this.perfSelect.appendChild(option);
    }

    // Default to medium
    this.perfSelect.value = "medium";

    this.perfSelect.addEventListener("change", () => {
      const preset = this.perfSelect.value as PerformancePreset;
      const settings = PERFORMANCE_PRESETS[preset];
      this.onPerformanceChange?.(settings);
    });

    perfWrap.appendChild(perfLabel);
    perfWrap.appendChild(this.perfSelect);

    //  world position label
    this.positionLabel = document.createElement("div");
    Object.assign(this.positionLabel.style, {
      whiteSpace: "pre",
    });
    this.positionLabel.textContent = "Player world: (0, 0, 0)";


    //fps label
    this.fpsLabel = document.createElement("div");
    Object.assign(this.fpsLabel.style, {
      whiteSpace: "pre",
    });
    this.fpsLabel.textContent = "FPS: 0";

    this.clientTypeLabel = document.createElement("div");
    Object.assign(this.clientTypeLabel.style, {
      whiteSpace: "pre",
    });
    this.clientTypeLabel.textContent = "Client: Unknown";

    this.gpuLabel = document.createElement("div");
    Object.assign(this.gpuLabel.style, {
      whiteSpace: "pre",
    });
    this.gpuLabel.textContent = "GPU: Unknown";

    // speed slider
    this.speedWrap = document.createElement("div");
    Object.assign(this.speedWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 8px",
      background: "rgba(0, 0, 0, 0.5)",
      borderRadius: "4px",
      pointerEvents: "auto",
    });

    const speedLabel = document.createElement("span");
    speedLabel.textContent = "Speed";
    this.speedValue = document.createElement("span");
    this.speedValue.textContent = "";
    Object.assign(this.speedValue.style, { minWidth: "42px", textAlign: "right" });

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.05";
    slider.max = "3";
    slider.step = "0.05";
    slider.value = "0.5";
    Object.assign(slider.style, { width: "120px" });
    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      this.speedValue.textContent = `${v.toFixed(2)} units/s`;
      this.onSpeedChange?.(v);
    });

    this.speedWrap.appendChild(speedLabel);
    this.speedWrap.appendChild(slider);
    this.speedWrap.appendChild(this.speedValue);

    // Bottom-left controls legend
    this.controlsHint = document.createElement("div");
    Object.assign(this.controlsHint.style, {
      maxWidth: "300px",
      padding: "8px 10px",
      background: "rgba(0, 0, 0, 0.55)",
      borderRadius: "6px",
      fontSize: "11px",
      lineHeight: "1.45",
      color: "#f3f4f6",
      whiteSpace: "pre-line",
      marginTop: "2px",
      pointerEvents: "auto",
    });
    this.controlsHint.textContent =
      "Controls\n" +
      "LMB drag: look around\n" +
      "W A S D: move\n" +
      "Q / E or Space / Shift: down / up\n" +
      "Mouse wheel: forward / back";

    this.technicalWrap = document.createElement("div");
    Object.assign(this.technicalWrap.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      padding: "4px 6px",
      borderRadius: "6px",
      color: "rgba(255, 255, 255, 0.92)",
      pointerEvents: "auto",
    });
    this.applyHoverSurface(this.technicalWrap, "6px");
    this.technicalWrap.appendChild(this.positionLabel);
    this.technicalWrap.appendChild(this.fpsLabel);
    this.technicalWrap.appendChild(this.clientTypeLabel);
    this.technicalWrap.appendChild(this.gpuLabel);

    this.topStack.appendChild(this.controlModeWrap);
    this.topStack.appendChild(perfWrap);
    this.topStack.appendChild(this.speedWrap);
    this.topStack.appendChild(this.controlsHint);
    this.bottomRow.appendChild(this.technicalWrap);

    this.root.appendChild(this.topStack);
    this.root.appendChild(this.bottomRow);
    this.container.appendChild(this.root);

    this.setControlMode("orbit");
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

  public setRuntimeInfo(info: { clientType?: string; gpuRenderer?: string }) {
    if (info.clientType) this.clientType = info.clientType;
    if (info.gpuRenderer) this.gpuRenderer = info.gpuRenderer;
  }

  public setSpeed(value: number) {
    this.speedValue.textContent = `${value.toFixed(2)} units/s`;
    const slider = this.speedWrap.querySelector("input[type=range]") as HTMLInputElement | null;
    if (slider) slider.value = value.toString();
  }

  public setSpeedChangeHandler(fn: (value: number) => void) {
    this.onSpeedChange = fn;
  }

  public setPerformanceChangeHandler(fn: (settings: PerformanceSettings) => void) {
    this.onPerformanceChange = fn;
  }

  public setControlModeChangeHandler(fn: (mode: ControlMode) => void) {
    this.onControlModeChange = fn;
  }

  public setControlMode(mode: ControlMode) {
    const activeStyle = {
      background: "rgba(255, 255, 255, 0.3)",
      borderColor: "rgba(255, 255, 255, 0.45)",
    };
    const inactiveStyle = {
      background: "rgba(255, 255, 255, 0.12)",
      borderColor: "rgba(255, 255, 255, 0.22)",
    };

    Object.assign(this.flyModeBtn.style, mode === "fly" ? activeStyle : inactiveStyle);
    Object.assign(this.orbitModeBtn.style, mode === "orbit" ? activeStyle : inactiveStyle);
    this.controlsHint.textContent =
      mode === "fly"
        ? "Controls (Fly)\n" +
          "LMB drag: look around\n" +
          "W A S D: move\n" +
          "Q / E or Space / Shift: down / up\n" +
          "Mouse wheel: forward / back"
        : "Controls (Orbit)\n" +
          "LMB drag: orbit\n" +
          "RMB drag: pan\n" +
          "Mouse wheel: zoom";
  }

  public setSpeedControlEnabled(enabled: boolean) {
    this.speedWrap.style.opacity = enabled ? "1" : "0.45";
    this.speedWrap.style.pointerEvents = enabled ? "auto" : "none";
  }

  public setPerformancePreset(preset: PerformancePreset) {
    this.perfSelect.value = preset;
  }

  public getPerformanceSettings(): PerformanceSettings {
    const preset = this.perfSelect.value as PerformancePreset;
    return PERFORMANCE_PRESETS[preset];
  }

  /**
   * Same here
   */
  public update() {
    const { x, y, z } = this.playerWorldPos;
    this.positionLabel.textContent =
      `Player world: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
    this.fpsLabel.textContent = `FPS: ${this.fps.toFixed(1)}`;
    this.clientTypeLabel.textContent = `Client: ${this.clientType}`;
    this.gpuLabel.textContent = `GPU: ${this.gpuRenderer}`;
  }

  public dispose() {
    if (this.root.parentElement === this.container) {
      this.container.removeChild(this.root);
    }
  }

  private styleModeButton(button: HTMLButtonElement) {
    Object.assign(button.style, {
      border: "1px solid rgba(255, 255, 255, 0.22)",
      background: "rgba(255, 255, 255, 0.12)",
      color: "#fff",
      borderRadius: "3px",
      fontSize: "11px",
      fontWeight: "600",
      padding: "2px 7px",
      cursor: "pointer",
    });
  }

  private applyHoverSurface(element: HTMLDivElement, radius: string) {
    element.style.background = "transparent";
    element.style.borderRadius = radius;
    element.style.transition = "background 140ms ease";
    element.addEventListener("mouseenter", () => {
      element.style.background = "rgba(0, 0, 0, 0.52)";
    });
    element.addEventListener("mouseleave", () => {
      element.style.background = "transparent";
    });
  }
}
