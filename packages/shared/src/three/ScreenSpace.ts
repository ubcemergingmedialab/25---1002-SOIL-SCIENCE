// ScreenSpace.ts
import * as THREE from "three";

export type PerformancePreset = "low" | "medium" | "high";
export type ControlMode = "fly" | "orbit";
export type MobileOrbitTool = "rotate" | "pan" | "zoom";
export type SceneInfo = {
  title?: string;
  location?: string;
  description?: string;
};

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
  private readonly sidebarUi: boolean;
  private root: HTMLDivElement;
  private topStack: HTMLDivElement;
  private viewerAddonHost: HTMLDivElement;
  private bottomRow: HTMLDivElement;
  private technicalWrap: HTMLDivElement;
  private positionLabel: HTMLDivElement;
  private fpsLabel: HTMLDivElement;
  private clientTypeLabel: HTMLDivElement;
  private gpuLabel: HTMLDivElement;
  private speedWrap: HTMLDivElement;
  private speedValue: HTMLSpanElement;
  private perfWrap: HTMLDivElement;
  private perfSelect: HTMLSelectElement;
  private controlsHint: HTMLDivElement;
  private controlModeWrap: HTMLDivElement;
  private flyModeBtn: HTMLButtonElement;
  private orbitModeBtn: HTMLButtonElement;
  private mobileTopBar: HTMLDivElement;
  private mobileBackBtn: HTMLButtonElement;
  private mobileInfoBtn: HTMLButtonElement;
  private mobilePlaceCard: HTMLDivElement;
  private mobilePlaceTitle: HTMLDivElement;
  private mobilePlaceLocation: HTMLSpanElement;
  private mobilePlaceDescription: HTMLDivElement;
  private mobileToolbar: HTMLDivElement;
  private mobileToolButtons: Record<MobileOrbitTool, HTMLButtonElement>;
  private mobileResetBtn: HTMLButtonElement;
  private onSpeedChange?: (value: number) => void;
  private onPerformanceChange?: (settings: PerformanceSettings) => void;
  private onControlModeChange?: (mode: ControlMode) => void;
  private onMobileOrbitToolChange?: (tool: MobileOrbitTool) => void;
  private onMobileReset?: () => void;
  private onMobileBack?: () => void;

  private playerWorldPos = new THREE.Vector3();
  private fps = 0;
  private clientType = "Unknown";
  private gpuRenderer = "Unknown";
  private controlMode: ControlMode = "orbit";
  private compactLayout = false;
  private speedControlEnabled = true;
  private mobileOrbitTool: MobileOrbitTool = "rotate";
  private mobilePlaceVisible = false;

  constructor(container: HTMLElement, sidebarUi = false) {
    this.container = container;
    this.sidebarUi = sidebarUi;
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
    if (this.sidebarUi) {
      this.topStack.className = "viewerSidebarPanel";
    }

    this.viewerAddonHost = document.createElement("div");
    Object.assign(this.viewerAddonHost.style, {
      pointerEvents: "auto",
    });
    if (this.sidebarUi) {
      this.viewerAddonHost.className = "viewerSidebarAddonHost";
    }

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
    if (this.sidebarUi) {
      this.controlModeWrap.className = "viewerSidebarControlRow";
    }

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

    this.flyModeBtn.addEventListener("click", () => {
      if (this.isCoarsePointer()) return;
      this.onControlModeChange?.("fly");
    });
    this.orbitModeBtn.addEventListener("click", () => this.onControlModeChange?.("orbit"));

    this.controlModeWrap.appendChild(modeLabel);
    this.controlModeWrap.appendChild(this.flyModeBtn);
    this.controlModeWrap.appendChild(this.orbitModeBtn);

    this.perfWrap = document.createElement("div");
    Object.assign(this.perfWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 8px",
      background: "rgba(0, 0, 0, 0.5)",
      borderRadius: "4px",
      pointerEvents: "auto",
    });
    if (this.sidebarUi) {
      this.perfWrap.className = "viewerSidebarControlRow";
    }

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

    this.perfWrap.appendChild(perfLabel);
    this.perfWrap.appendChild(this.perfSelect);

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
    if (this.sidebarUi) {
      this.speedWrap.className = "viewerSidebarControlRow";
    }

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
    if (this.sidebarUi) {
      this.controlsHint.className = "viewerSidebarInstructions";
    }
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
    if (this.sidebarUi) {
      this.technicalWrap.className = "viewerSidebarTechnical";
    } else {
      this.applyHoverSurface(this.technicalWrap, "6px");
    }
    this.technicalWrap.appendChild(this.positionLabel);
    this.technicalWrap.appendChild(this.fpsLabel);
    this.technicalWrap.appendChild(this.clientTypeLabel);
    this.technicalWrap.appendChild(this.gpuLabel);

    this.mobileTopBar = document.createElement("div");
    Object.assign(this.mobileTopBar.style, {
      display: "none",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      pointerEvents: "none",
    });

    this.mobileBackBtn = this.createMobileRoundButton(
      "Back",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5 8 12l7.5 7.5" /></svg>'
    );
    this.mobileBackBtn.addEventListener("click", () => this.onMobileBack?.());

    this.mobileInfoBtn = this.createMobileRoundButton(
      "Scene information",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10.5v6" /><path d="M12 7.5h.01" /></svg>'
    );
    this.mobileInfoBtn.addEventListener("click", () => {
      this.mobilePlaceVisible = !this.mobilePlaceVisible;
      this.mobilePlaceCard.style.display = this.mobilePlaceVisible ? "block" : "none";
      this.mobileInfoBtn.setAttribute("aria-pressed", String(this.mobilePlaceVisible));
    });
    this.mobileInfoBtn.setAttribute("aria-pressed", "false");

    this.mobileTopBar.appendChild(this.mobileBackBtn);
    this.mobileTopBar.appendChild(this.mobileInfoBtn);

    this.mobilePlaceCard = document.createElement("div");
    Object.assign(this.mobilePlaceCard.style, {
      display: "none",
      pointerEvents: "auto",
      alignSelf: "flex-end",
      width: "min(330px, calc(100% - 48px))",
      maxHeight: "min(46vh, 420px)",
      overflow: "auto",
      margin: "14px 8px 0 0",
      padding: "13px 18px 16px",
      borderRadius: "18px",
      background: "rgba(9, 8, 5, 0.68)",
      color: "#fff",
      backdropFilter: "blur(18px)",
      boxShadow: "0 12px 32px rgba(0, 0, 0, 0.3)",
    });

    const mobilePlaceHandle = document.createElement("div");
    Object.assign(mobilePlaceHandle.style, {
      width: "64px",
      height: "5px",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.36)",
      margin: "0 auto 12px",
    });

    this.mobilePlaceTitle = document.createElement("div");
    Object.assign(this.mobilePlaceTitle.style, {
      fontSize: "22px",
      fontWeight: "700",
      lineHeight: "1.1",
      marginBottom: "10px",
    });

    const mobilePlaceLocationRow = document.createElement("div");
    Object.assign(mobilePlaceLocationRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "9px",
      color: "rgba(255,255,255,0.78)",
      fontSize: "15px",
      marginBottom: "12px",
    });
    mobilePlaceLocationRow.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:20px;height:20px;stroke:#1fb6a6;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto;"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    this.mobilePlaceLocation = document.createElement("span");
    mobilePlaceLocationRow.appendChild(this.mobilePlaceLocation);

    this.mobilePlaceDescription = document.createElement("div");
    Object.assign(this.mobilePlaceDescription.style, {
      color: "rgba(255,255,255,0.88)",
      fontSize: "14px",
      lineHeight: "1.45",
      whiteSpace: "pre-wrap",
    });

    this.mobilePlaceCard.appendChild(mobilePlaceHandle);
    this.mobilePlaceCard.appendChild(this.mobilePlaceTitle);
    this.mobilePlaceCard.appendChild(mobilePlaceLocationRow);
    this.mobilePlaceCard.appendChild(this.mobilePlaceDescription);
    this.setMobileSceneInfo({});

    this.mobileToolButtons = {
      rotate: this.createMobileToolButton(
        "Rotate",
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 8.5a7 7 0 1 0 1.1 7.2" /><path d="M18 3.5v5h-5" /></svg>'
      ),
      pan: this.createMobileToolButton(
        "Pan",
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11.5V7.8a1.8 1.8 0 0 1 3.6 0v3.7" /><path d="M11.6 11V6.7a1.8 1.8 0 0 1 3.6 0V12" /><path d="M15.2 12V8.3a1.8 1.8 0 0 1 3.6 0v5.2c0 4.2-2.7 7-6.8 7h-1.1c-2.5 0-4.4-1.1-5.7-3.1L3.4 14a1.7 1.7 0 0 1 2.9-1.8L8 14.4V11.5Z" /></svg>'
      ),
      zoom: this.createMobileToolButton(
        "Zoom",
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /><path d="M8 10.5h5" /><path d="M10.5 8v5" /></svg>'
      ),
    };
    this.mobileResetBtn = this.createMobileToolButton(
      "Reset",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2.8v3" /><path d="M12 18.2v3" /><path d="M2.8 12h3" /><path d="M18.2 12h3" /><path d="M4.9 4.9l2.1 2.1" /><path d="M17 17l2.1 2.1" /></svg>'
    );

    for (const [tool, button] of Object.entries(this.mobileToolButtons) as Array<[MobileOrbitTool, HTMLButtonElement]>) {
      button.addEventListener("click", () => {
        this.setMobileOrbitTool(tool);
        this.onMobileOrbitToolChange?.(tool);
      });
    }
    this.mobileResetBtn.addEventListener("click", () => this.onMobileReset?.());

    this.mobileToolbar = document.createElement("div");
    Object.assign(this.mobileToolbar.style, {
      display: "none",
      pointerEvents: "auto",
      width: "calc(100% - 48px)",
      alignSelf: "center",
      marginTop: "auto",
      marginBottom: "max(18px, env(safe-area-inset-bottom))",
      padding: "14px 14px 12px",
      borderRadius: "18px",
      background: "rgba(9, 8, 5, 0.72)",
      backdropFilter: "blur(18px)",
      boxShadow: "0 16px 40px rgba(0, 0, 0, 0.3)",
      justifyContent: "space-between",
      gap: "10px",
    });
    this.mobileToolbar.appendChild(this.mobileToolButtons.rotate);
    this.mobileToolbar.appendChild(this.mobileToolButtons.pan);
    this.mobileToolbar.appendChild(this.mobileToolButtons.zoom);
    this.mobileToolbar.appendChild(this.mobileResetBtn);

    this.topStack.appendChild(this.controlModeWrap);
    this.topStack.appendChild(this.perfWrap);
    this.topStack.appendChild(this.speedWrap);
    this.topStack.appendChild(this.controlsHint);
    this.topStack.appendChild(this.viewerAddonHost);
    if (this.sidebarUi) {
      this.topStack.appendChild(this.technicalWrap);
    } else {
      this.bottomRow.appendChild(this.technicalWrap);
    }

    this.root.appendChild(this.mobileTopBar);
    this.root.appendChild(this.topStack);
    this.root.appendChild(this.mobilePlaceCard);
    this.root.appendChild(this.mobileToolbar);
    this.root.appendChild(this.bottomRow);
    this.container.appendChild(this.root);

    this.setControlMode("orbit");
    this.applyResponsiveLayout();
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

  public setMobileSceneInfo(info: SceneInfo) {
    const title = info.title?.trim() || "Untitled field";
    const location = info.location?.trim() || "Location unavailable";
    const description = info.description?.trim() || "No description available yet.";

    this.mobilePlaceTitle.textContent = title;
    this.mobilePlaceLocation.textContent = location;
    this.mobilePlaceDescription.textContent = description;
  }

  public getViewerAddonHost(): HTMLDivElement {
    return this.viewerAddonHost;
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

  public setMobileOrbitToolChangeHandler(fn: (tool: MobileOrbitTool) => void) {
    this.onMobileOrbitToolChange = fn;
  }

  public setMobileResetHandler(fn: () => void) {
    this.onMobileReset = fn;
  }

  public setMobileBackHandler(fn: (() => void) | undefined) {
    this.onMobileBack = fn;
  }

  public setMobileOrbitTool(tool: MobileOrbitTool) {
    this.mobileOrbitTool = tool;
    const activeStyle = {
      background: "rgba(255, 255, 255, 0.18)",
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.16)",
    };
    const inactiveStyle = {
      background: "transparent",
      boxShadow: "none",
    };

    for (const [key, button] of Object.entries(this.mobileToolButtons) as Array<[MobileOrbitTool, HTMLButtonElement]>) {
      Object.assign(button.style, key === tool ? activeStyle : inactiveStyle);
    }
    Object.assign(this.mobileResetBtn.style, inactiveStyle);
  }

  public setControlMode(mode: ControlMode) {
    if (mode === "fly" && this.isCoarsePointer()) {
      mode = "orbit";
    }

    this.controlMode = mode;
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
    this.updateControlsHint();
    this.applyResponsiveLayout();
  }

  public setSpeedControlEnabled(enabled: boolean) {
    this.speedControlEnabled = enabled;
    this.applyResponsiveLayout();
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
    this.applyResponsiveLayout();
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

  private createMobileRoundButton(label: string, icon: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.ariaLabel = label;
    button.title = label;
    button.innerHTML = icon;
    Object.assign(button.style, {
      width: "58px",
      height: "58px",
      border: "0",
      borderRadius: "999px",
      background: "rgba(0, 0, 0, 0.64)",
      color: "#fff",
      display: "grid",
      placeItems: "center",
      pointerEvents: "auto",
      cursor: "pointer",
      backdropFilter: "blur(16px)",
      boxShadow: "0 12px 28px rgba(0, 0, 0, 0.28)",
    });
    const svg = button.querySelector("svg");
    if (svg) {
      Object.assign(svg.style, {
        width: "31px",
        height: "31px",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2.2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      });
    }
    return button;
  }

  private createMobileToolButton(label: string, icon: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.ariaLabel = label;
    button.title = label;
    button.innerHTML = `<span>${icon}</span><strong>${label}</strong>`;
    Object.assign(button.style, {
      flex: "1 1 0",
      minWidth: "0",
      border: "0",
      borderRadius: "14px",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "8px",
      padding: "5px 2px 2px",
      cursor: "pointer",
      font: "inherit",
    });
    const iconWrap = button.querySelector("span") as HTMLSpanElement | null;
    Object.assign(iconWrap?.style ?? {}, {
      width: "47px",
      height: "47px",
      borderRadius: "999px",
      background: "rgba(0, 0, 0, 0.66)",
      display: "grid",
      placeItems: "center",
    });
    const svg = button.querySelector("svg");
    if (svg) {
      Object.assign(svg.style, {
        width: "31px",
        height: "31px",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2.1",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      });
    }
    const labelEl = button.querySelector("strong") as HTMLElement | null;
    Object.assign(labelEl?.style ?? {}, {
      fontSize: "13px",
      lineHeight: "1",
      fontWeight: "600",
      color: "rgba(255, 255, 255, 0.86)",
    });
    return button;
  }

  private applyResponsiveLayout() {
    const mobile = this.isCoarsePointer();
    const compact = this.isCompactViewport();
    if (compact === this.compactLayout) {
      this.applyMobileVisibility(mobile);
      this.applySpeedVisibility();
      return;
    }

    this.compactLayout = compact;
    Object.assign(this.root.style, {
      padding: compact
        ? "max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))"
        : "8px",
      fontSize: compact ? "13px" : "12px",
    });
    Object.assign(this.topStack.style, {
      flexDirection: compact ? "row" : "column",
      flexWrap: compact ? "wrap" : "nowrap",
      gap: compact ? "6px" : "4px",
      alignItems: compact ? "flex-start" : "flex-start",
      maxWidth: compact ? "calc(100% - 56px)" : "none",
    });
    Object.assign(this.controlModeWrap.style, {
      minHeight: compact ? "40px" : "auto",
      padding: compact ? "4px 6px" : "4px 8px",
    });
    Object.assign(this.perfWrap.style, {
      minHeight: compact ? "40px" : "auto",
      padding: compact ? "4px 6px" : "4px 8px",
    });
    Object.assign(this.perfSelect.style, {
      minHeight: compact ? "32px" : "auto",
      fontSize: compact ? "13px" : "12px",
    });
    for (const button of [this.flyModeBtn, this.orbitModeBtn]) {
      Object.assign(button.style, {
        minHeight: compact ? "32px" : "auto",
        minWidth: compact ? "48px" : "auto",
        padding: compact ? "4px 9px" : "2px 7px",
        fontSize: compact ? "12px" : "11px",
      });
    }
    this.flyModeBtn.disabled = this.isCoarsePointer();
    Object.assign(this.flyModeBtn.style, {
      display: this.isCoarsePointer() ? "none" : "inline-block",
    });

    this.controlsHint.style.display = compact ? "none" : "block";
    this.technicalWrap.style.display = compact ? "none" : "flex";
    this.applyMobileVisibility(mobile);
    this.applySpeedVisibility();
    this.updateControlsHint();
  }

  private applyMobileVisibility(mobile: boolean) {
    this.mobileTopBar.style.display = mobile ? "flex" : "none";
    this.mobilePlaceCard.style.display =
      mobile && this.mobilePlaceVisible ? "block" : "none";
    this.mobileToolbar.style.display = mobile ? "flex" : "none";
    this.topStack.style.display = mobile ? "none" : "flex";
    this.bottomRow.style.display = mobile || this.sidebarUi ? "none" : "flex";
    this.mobileBackBtn.style.visibility = this.onMobileBack ? "visible" : "hidden";
    this.setMobileOrbitTool(this.mobileOrbitTool);
  }

  private applySpeedVisibility() {
    if (this.compactLayout) {
      this.speedWrap.style.display = "none";
      return;
    }

    this.speedWrap.style.display = "flex";
    this.speedWrap.style.opacity = this.speedControlEnabled ? "1" : "0.45";
    this.speedWrap.style.pointerEvents = this.speedControlEnabled ? "auto" : "none";
  }

  private updateControlsHint() {
    if (this.isCoarsePointer()) {
      this.controlsHint.textContent =
        this.controlMode === "fly"
          ? "Controls (Fly)\nDrag: look around\nUse desktop keyboard controls for movement"
          : "Controls (Orbit)\nDrag: orbit\nPinch: zoom\nTwo-finger drag: pan";
      return;
    }

    this.controlsHint.textContent =
      this.controlMode === "fly"
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

  private isCompactViewport(): boolean {
    return this.isCoarsePointer();
  }

  private isCoarsePointer(): boolean {
    return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
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
