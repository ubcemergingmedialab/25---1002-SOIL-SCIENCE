type PlayCanvasLoadingOverlayProps = {
  hint?: string;
  progress?: number | null;
  title?: string;
  className?: string;
};

export default function PlayCanvasLoadingOverlay({
  hint = "Preparing scene...",
  progress = null,
  title = "Loading Virtual Soil",
  className = "",
}: PlayCanvasLoadingOverlayProps) {
  const clampedProgress =
    progress === null || Number.isNaN(progress)
      ? null
      : Math.max(0, Math.min(1, progress));

  const progressLabel =
    clampedProgress === null
      ? undefined
      : `${Math.round(clampedProgress * 100)}%`;

  return (
    <div
      className={`playCanvasLoadingOverlay${className ? ` ${className}` : ""}`}
      aria-live="polite"
      role="status"
    >
      <div className="playCanvasLoadingCard">
        <div className="playCanvasLoadingSpinner" aria-hidden="true" />
        <div className="playCanvasLoadingTitle">{title}</div>
        <div className="playCanvasLoadingHint">{hint}</div>
        <div
          className="playCanvasLoadingProgressTrack"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clampedProgress === null ? undefined : Math.round(clampedProgress * 100)}
          aria-valuetext={progressLabel}
        >
          <div
            className={`playCanvasLoadingProgressFill${
              clampedProgress === null ? " isIndeterminate" : ""
            }`}
            style={
              clampedProgress === null
                ? undefined
                : { width: `${Math.round(clampedProgress * 100)}%` }
            }
          />
        </div>
      </div>
    </div>
  );
}
