export class LoadingOverlay {
  private container: HTMLElement;
  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private spinner: HTMLDivElement;
  private label: HTMLDivElement;
  private hint: HTMLDivElement;
  private progressTrack: HTMLDivElement;
  private progressFill: HTMLDivElement;
  private hidden = false;

  constructor(container: HTMLElement) {
    this.container = container;

    const style = getComputedStyle(container);
    if (style.position === "static" || !style.position) {
      container.style.position = "relative";
    }

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background:
        "radial-gradient(circle at 35% 25%, rgba(59,130,246,0.2), rgba(7,10,16,0.97) 45%, rgba(0,0,0,0.98))",
      transition: "opacity 320ms ease",
      opacity: "1",
      pointerEvents: "auto",
      zIndex: "10",
    });

    this.card = document.createElement("div");
    Object.assign(this.card.style, {
      width: "min(540px, 86%)",
      borderRadius: "14px",
      background: "rgba(17, 24, 39, 0.72)",
      border: "1px solid rgba(148, 163, 184, 0.28)",
      boxShadow: "0 16px 45px rgba(0, 0, 0, 0.45)",
      backdropFilter: "blur(8px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "26px 24px 22px",
      gap: "12px",
    });

    this.spinner = document.createElement("div");
    Object.assign(this.spinner.style, {
      width: "46px",
      height: "46px",
      border: "3px solid rgba(148,163,184,0.35)",
      borderTopColor: "#cbd5e1",
      borderRadius: "50%",
      animation: "loading-overlay-spin 1s linear infinite",
    });

    this.label = document.createElement("div");
    this.label.textContent = "Loading Virtual Soil";
    Object.assign(this.label.style, {
      marginTop: "6px",
      color: "#f8fafc",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: "18px",
      letterSpacing: "0.3px",
      fontWeight: "600",
    });

    this.hint = document.createElement("div");
    this.hint.textContent = "Preparing scene...";
    Object.assign(this.hint.style, {
      color: "rgba(226, 232, 240, 0.9)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: "13px",
      letterSpacing: "0.2px",
      minHeight: "18px",
    });

    this.progressTrack = document.createElement("div");
    Object.assign(this.progressTrack.style, {
      width: "100%",
      height: "8px",
      borderRadius: "999px",
      background: "rgba(100, 116, 139, 0.38)",
      overflow: "hidden",
      marginTop: "2px",
    });

    this.progressFill = document.createElement("div");
    Object.assign(this.progressFill.style, {
      width: "0%",
      height: "100%",
      borderRadius: "999px",
      background: "linear-gradient(90deg, #7dd3fc, #60a5fa, #22d3ee)",
      transition: "width 140ms ease",
    });
    this.progressTrack.appendChild(this.progressFill);

    this.ensureKeyframes();

    this.card.appendChild(this.spinner);
    this.card.appendChild(this.label);
    this.card.appendChild(this.hint);
    this.card.appendChild(this.progressTrack);
    this.root.appendChild(this.card);
    this.container.appendChild(this.root);
  }

  show() {
    if (this.hidden) {
      this.hidden = false;
      this.root.style.opacity = "1";
      this.root.style.pointerEvents = "auto";
      if (!this.root.parentElement) {
        this.container.appendChild(this.root);
      }
    }
    this.setProgress(0);
    this.setHint("Preparing scene...");
  }

  hide() {
    if (this.hidden) return;
    this.hidden = true;
    this.root.style.opacity = "0";
    this.root.style.pointerEvents = "none";
    const handle = () => {
      this.root.removeEventListener("transitionend", handle);
      if (this.root.parentElement === this.container) {
        this.container.removeChild(this.root);
      }
    };
    this.root.addEventListener("transitionend", handle);
    //just in case 
    window.setTimeout(handle, 400);
  }

  dispose() {
    this.hide();
  }

  setHint(text: string) {
    this.hint.textContent = text;
  }

  setProgress(progress: number | null) {
    if (progress === null || Number.isNaN(progress)) {
      this.progressFill.style.width = "42%";
      this.progressFill.style.opacity = "0.6";
      this.progressFill.style.animation = "loading-overlay-pulse 1.1s ease-in-out infinite";
      return;
    }
    this.progressFill.style.animation = "none";
    this.progressFill.style.opacity = "1";
    const clamped = Math.max(0, Math.min(1, progress));
    this.progressFill.style.width = `${Math.round(clamped * 100)}%`;
  }

  private ensureKeyframes() {
    const id = "loading-overlay-spin-style";
    if (document.getElementById(id)) return;
    const styleEl = document.createElement("style");
    styleEl.id = id;
    styleEl.textContent = `
      @keyframes loading-overlay-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes loading-overlay-pulse {
        0% { filter: brightness(0.85); }
        50% { filter: brightness(1.2); }
        100% { filter: brightness(0.85); }
      }
    `;
    document.head.appendChild(styleEl);
  }
}
