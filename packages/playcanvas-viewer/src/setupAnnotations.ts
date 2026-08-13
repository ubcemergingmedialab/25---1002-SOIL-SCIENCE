// @ts-nocheck
import * as pc from "playcanvas";
import {
  Annotation,
  AnnotationManager,
} from "playcanvas/scripts/esm/annotations.mjs";
import type { CameraControls } from "playcanvas/scripts/esm/camera-controls.mjs";
import type { NavigableMarker } from "@soil/shared/markers/navigableMarkers";
import { DEFAULT_MARKER_RADIUS } from "@soil/shared/markers/editorMarkers";
import {
  flyCameraToMarker,
  type CameraControlHooks,
  type CameraPositionClamp,
} from "./markerCamera";
import { loadMarkerIconTexture } from "./markerIconTexture";
import {
  setupEditorPlacement,
  type PlacementPreviewState,
} from "./editorPlacement";
import { mapLegacyStoredPosition, mapDisplayToLegacyStored } from "./sceneCoordinates";

export type { PlacementPreviewState };

/** Matches legacy WorldMarkers selected tint (`#3b82f6`). */
const SELECTED_HOTSPOT_COLOR = new pc.Color(0.231, 0.509, 0.965);

export type PlayCanvasMarkersHandle = {
  flyToMarker(index: number): void;
  setMarkers(
    markers: NavigableMarker[],
    options?: { selectedIndex?: number | null },
  ): void;
  setSelectedIndex(index: number | null): void;
  showMarkerLabel(index: number): void;
  hideMarkerLabel(): void;
  setMarkerClickHandler(handler: ((index: number) => void) | null): void;
  setPlacementPreview(state: PlacementPreviewState | null): void;
  getPlacementPosition(): [number, number, number];
  getCameraPosition(): [number, number, number];
  getMarkerPosition(index: number): [number, number, number] | null;
  getMarkerRadius(index: number): number | null;
  setMarkerPosition(index: number, position: [number, number, number]): void;
  setHotspotPointerEvents(index: number | null, enabled: boolean): void;
  destroy(): void;
};

export function setupPlayCanvasMarkers(options: {
  app: pc.AppBase;
  cameraEntity: pc.Entity;
  controls: InstanceType<typeof CameraControls> | null;
  markers: NavigableMarker[];
  overlayParent: HTMLElement;
  selectedIndex?: number | null;
  onMarkerClick?: (index: number) => void;
  /** When true (viewer default), hotspot click flies the camera. */
  flyOnMarkerClick?: boolean;
  cameraControlHooks?: CameraControlHooks;
  clampCameraPosition?: CameraPositionClamp | null;
  splatEntity?: pc.Entity;
}): PlayCanvasMarkersHandle {
  const {
    app,
    cameraEntity,
    controls,
    overlayParent,
    flyOnMarkerClick = true,
    cameraControlHooks,
    clampCameraPosition,
    splatEntity,
  } = options;

  let markers = [...options.markers];
  let selectedIndex = options.selectedIndex ?? null;
  let markerClickHandler = options.onMarkerClick ?? null;
  let activeTransition = null;
  let programmaticTooltipShow = false;

  const displayPosition = (position: [number, number, number]) =>
    splatEntity
      ? mapLegacyStoredPosition(position, splatEntity)
      : position;

  const markerEntities = [];
  const annotationScripts = [];
  let selectedAnnotation = null;

  class ViewerAnnotationManager extends AnnotationManager {
    static scriptName = "viewerAnnotationManager";

    _markerIconUrls = new Map();
    _iconLoadTokens = new Map();
    _pendingIconByEntity = new Map();
    _markerRadius = new Map();

    _radiusMultiplier(annotation) {
      const radius = this._markerRadius.get(annotation) ?? DEFAULT_MARKER_RADIUS;
      return radius / DEFAULT_MARKER_RADIUS;
    }

    setMarkerRadius(annotation, radius) {
      const next =
        typeof radius === "number" && Number.isFinite(radius) ? radius : DEFAULT_MARKER_RADIUS;
      this._markerRadius.set(annotation, next);
    }

    _updateAnnotationRotationAndScale(annotation, viewDepth) {
      super._updateAnnotationRotationAndScale(annotation, viewDepth);
      const multiplier = this._radiusMultiplier(annotation);
      if (multiplier === 1) return;

      const scale = annotation.entity.getLocalScale();
      annotation.entity.setLocalScale(
        scale.x * multiplier,
        scale.y * multiplier,
        scale.z * multiplier,
      );
    }

    _updateAnnotationPositions(annotation, resources, screenPos) {
      super._updateAnnotationPositions(annotation, resources, screenPos);
      const multiplier = this._radiusMultiplier(annotation);
      if (multiplier === 1) return;

      const size = (this._hotspotSize + 5) * multiplier;
      resources.hotspotDom.style.width = `${size}px`;
      resources.hotspotDom.style.height = `${size}px`;
    }

    initialize() {
      this._parentDom = overlayParent;
      this._camera = cameraEntity;
      super.initialize();
    }

    stageMarkerIcon(entity, iconUrl) {
      const trimmed = iconUrl?.trim();
      if (!trimmed) return;
      this._pendingIconByEntity.set(entity, trimmed);
    }

    updateMarkerIcon(annotation, iconUrl, fallbackLabel) {
      const trimmed = iconUrl?.trim();
      if (trimmed) {
        this._markerIconUrls.set(annotation, trimmed);
        if (annotation.label !== " ") {
          annotation.label = " ";
        }
        this._applyIconTexture(annotation, trimmed);
        return;
      }

      const token = (this._iconLoadTokens.get(annotation) ?? 0) + 1;
      this._iconLoadTokens.set(annotation, token);
      this._markerIconUrls.delete(annotation);

      const resources = this._annotationResources.get(annotation);
      if (resources?.texture) {
        resources.texture.destroy();
      }

      annotation.label = fallbackLabel;
    }

    _applyIconTexture(annotation, iconUrl) {
      const token = (this._iconLoadTokens.get(annotation) ?? 0) + 1;
      this._iconLoadTokens.set(annotation, token);

      loadMarkerIconTexture(this.app.graphicsDevice, iconUrl)
        .then((texture) => {
          if (this._iconLoadTokens.get(annotation) !== token) {
            texture.destroy();
            return;
          }

          const resources = this._annotationResources.get(annotation);
          if (!resources) {
            texture.destroy();
            return;
          }

          resources.texture.destroy();
          resources.texture = texture;
          resources.materials.forEach((material) => {
            material.emissive.set(1, 1, 1);
            material.emissiveMap = texture;
            material.opacityMap = texture;
            material.update();
          });

          if (annotation === selectedAnnotation) {
            this._applySelectionTint(annotation, true);
          }
        })
        .catch((err) => {
          console.warn("[playcanvas-viewer] marker icon load failed:", iconUrl, err);
        });
    }

    _registerAnnotation(annotation) {
      super._registerAnnotation(annotation);

      const iconUrl = this._pendingIconByEntity.get(annotation.entity);
      if (!iconUrl) return;

      this._pendingIconByEntity.delete(annotation.entity);
      this._markerIconUrls.set(annotation, iconUrl);
      this._applyIconTexture(annotation, iconUrl);
    }

    _unregisterAnnotation(annotation) {
      if (selectedAnnotation === annotation) {
        selectedAnnotation = null;
      }
      this._markerIconUrls.delete(annotation);
      this._iconLoadTokens.delete(annotation);
      this._markerRadius.delete(annotation);
      this._pendingIconByEntity.delete(annotation.entity);
      super._unregisterAnnotation(annotation);
    }

    _onLabelChange(annotation, label) {
      if (this._markerIconUrls.has(annotation)) {
        return;
      }
      super._onLabelChange(annotation, label);
      if (annotation === selectedAnnotation) {
        this._applySelectionTint(annotation, true);
      }
    }

    _applySelectionTint(annotation, selected) {
      const resources = this._annotationResources.get(annotation);
      if (!resources) return;

      const hasIcon = this._markerIconUrls.has(annotation);
      resources.materials.forEach((material) => {
        if (selected) {
          material.emissive.copy(SELECTED_HOTSPOT_COLOR);
        } else if (hasIcon) {
          material.emissive.set(1, 1, 1);
        } else {
          material.emissive.copy(this._hotspotColor);
        }
        material.update();
      });
    }

    setSelectedAnnotation(annotation) {
      if (selectedAnnotation && selectedAnnotation !== annotation) {
        this._applySelectionTint(selectedAnnotation, false);
      }
      selectedAnnotation = annotation;
      if (annotation) {
        this._applySelectionTint(annotation, true);
      }
    }

    showTooltipFor(annotation) {
      if (!annotation) return;
      this._showTooltip(annotation);
    }

    hideActiveTooltip() {
      if (this._activeAnnotation) {
        this._hideTooltip(this._activeAnnotation);
      }
    }

    _setAnnotationHover(annotation, hover) {
      if (annotation === selectedAnnotation) return;
      super._setAnnotationHover(annotation, hover);
    }
  }

  const managerEntity = new pc.Entity("annotationManager");
  app.root.addChild(managerEntity);
  managerEntity.addComponent("script");
  const manager = managerEntity.script.create(ViewerAnnotationManager);

  // AnnotationManager shares one PlaneGeometry mesh across every hotspot.
  // MeshInstance.destroy() releases that mesh when the last instance is gone,
  // which happens on marker rebuild/delete. WebGPU then builds a pipeline
  // against empty vertex buffers and loses the device (black/frozen canvas).
  const pinSharedHotspotMesh = () => {
    const mesh = manager._mesh;
    if (!mesh || mesh._soilHotspotPinned) return;
    mesh.incRefCount();
    mesh._soilHotspotPinned = true;
  };

  const ensureSharedHotspotMesh = () => {
    if (manager._mesh?.vertexBuffer) {
      pinSharedHotspotMesh();
      return;
    }
    manager._mesh = pc.Mesh.fromGeometry(
      app.graphicsDevice,
      new pc.PlaneGeometry({ widthSegments: 1, lengthSegments: 1 }),
    );
    pinSharedHotspotMesh();
  };

  pinSharedHotspotMesh();

  const flyTo = (index) => {
    const marker = markers[index];
    if (!marker) return;

    activeTransition?.cancel();
    activeTransition = flyCameraToMarker(
      app,
      cameraEntity,
      controls,
      displayPosition(marker.position),
      displayPosition(marker.viewPosition),
      cameraControlHooks,
      clampCameraPosition,
    );
  };

  const normalizeRadius = (marker) => {
    const radius = marker?.radius;
    return typeof radius === "number" && Number.isFinite(radius) ? radius : DEFAULT_MARKER_RADIUS;
  };

  const markersContentEqual = (a, b) => {
    if (a.length !== b.length) return false;
    return a.every((marker, index) => {
      const other = b[index];
      if (!other) return false;
      return marker.title === other.title && marker.description === other.description;
    });
  };

  const markersViewEqual = (a, b) => {
    if (a.length !== b.length) return false;
    return a.every((marker, index) => {
      const other = b[index];
      if (!other) return false;
      return (
        marker.viewPosition[0] === other.viewPosition[0] &&
        marker.viewPosition[1] === other.viewPosition[1] &&
        marker.viewPosition[2] === other.viewPosition[2]
      );
    });
  };

  const syncMarkerContent = () => {
    markers.forEach((marker, index) => {
      const annotation = annotationScripts[index];
      if (!annotation) return;

      const nextTitle = marker.title || `Marker ${index + 1}`;
      const nextText = marker.description ?? "";

      // Icon markers use a custom texture; never touch label (label:set replaces it).
      if (!marker.icon) {
        const labelChar = marker.title.trim().charAt(0) || `${index + 1}`;
        const nextLabel = labelChar.toUpperCase();
        if (annotation.label !== nextLabel) {
          annotation.label = nextLabel;
        }
      }

      if (annotation.title !== nextTitle) {
        annotation.title = nextTitle;
      }
      if (annotation.text !== nextText) {
        annotation.text = nextText;
      }

      manager._applySelectionTint(annotation, index === selectedIndex);
    });
  };

  const syncMarkerPositions = () => {
    markers.forEach((marker, index) => {
      const entity = markerEntities[index];
      if (!entity) return;
      const [x, y, z] = displayPosition(marker.position);
      entity.setPosition(x, y, z);
    });
  };

  const syncMarkerIcons = () => {
    markers.forEach((marker, index) => {
      const annotation = annotationScripts[index];
      if (!annotation) return;

      const currentIcon = manager._markerIconUrls.get(annotation)?.trim() ?? "";
      const nextIcon = marker.icon?.trim() ?? "";
      if (currentIcon === nextIcon) return;

      const labelChar = marker.title.trim().charAt(0) || `${index + 1}`;
      manager.updateMarkerIcon(annotation, nextIcon, labelChar.toUpperCase());
      manager._applySelectionTint(annotation, index === selectedIndex);
    });
  };

  const syncMarkerRadii = () => {
    markers.forEach((marker, index) => {
      const annotation = annotationScripts[index];
      if (!annotation) return;
      manager.setMarkerRadius(annotation, normalizeRadius(marker));
    });
  };

  const applySelectedIndex = (index) => {
    selectedIndex = index;
    const annotation =
      index !== null && index >= 0 ? annotationScripts[index] ?? null : null;
    manager.setSelectedAnnotation(annotation);
  };

  const markerIdentityKey = (marker) =>
    [
      marker.title,
      marker.description ?? "",
      marker.icon ?? "",
      marker.position.join(","),
      marker.viewPosition.join(","),
      String(normalizeRadius(marker)),
    ].join("\0");

  /** Detect a single insert or delete so we don't destroy every hotspot mesh. */
  const findLengthSplice = (prev, next) => {
    if (Math.abs(prev.length - next.length) !== 1) return null;
    const prevKeys = prev.map(markerIdentityKey);
    const nextKeys = next.map(markerIdentityKey);
    const removing = prev.length > next.length;
    const longer = removing ? prevKeys : nextKeys;
    const shorter = removing ? nextKeys : prevKeys;
    let spliceIndex = -1;
    let shortIndex = 0;
    for (let i = 0; i < longer.length; i++) {
      if (shortIndex < shorter.length && longer[i] === shorter[shortIndex]) {
        shortIndex += 1;
        continue;
      }
      if (spliceIndex !== -1) return null;
      spliceIndex = i;
    }
    if (spliceIndex === -1) spliceIndex = longer.length - 1;
    if (shortIndex !== shorter.length) return null;
    return { op: removing ? "remove" : "add", index: spliceIndex };
  };

  const createMarkerEntity = (marker, index) => {
    ensureSharedHotspotMesh();

    const entity = new pc.Entity("marker");
    const [x, y, z] = displayPosition(marker.position);
    entity.setPosition(x, y, z);
    app.root.addChild(entity);
    entity.addComponent("script");
    manager.stageMarkerIcon(entity, marker.icon);

    const annotation = entity.script.create(Annotation);

    const labelChar = marker.title.trim().charAt(0) || `${index + 1}`;
    annotation.label = marker.icon ? " " : labelChar.toUpperCase();
    annotation.title = marker.title || `Marker ${index + 1}`;
    annotation.text = marker.description;
    manager.setMarkerRadius(annotation, normalizeRadius(marker));

    annotation.on("show", () => {
      if (programmaticTooltipShow) return;
      const liveIndex = annotationScripts.indexOf(annotation);
      if (liveIndex < 0) return;
      if (markerClickHandler) {
        markerClickHandler(liveIndex);
        return;
      }
      if (flyOnMarkerClick) {
        flyTo(liveIndex);
      }
    });

    return { entity, annotation };
  };

  const clearMarkerEntities = () => {
    markerEntities.forEach((entity) => entity.destroy());
    markerEntities.length = 0;
    annotationScripts.length = 0;
    selectedAnnotation = null;
  };

  const removeMarkerAt = (index) => {
    manager.hideActiveTooltip();
    const entity = markerEntities[index];
    markerEntities.splice(index, 1);
    annotationScripts.splice(index, 1);
    entity?.destroy();
  };

  const insertMarkerAt = (index, marker) => {
    const { entity, annotation } = createMarkerEntity(marker, index);
    markerEntities.splice(index, 0, entity);
    annotationScripts.splice(index, 0, annotation);
  };

  const rebuildMarkers = () => {
    manager.hideActiveTooltip();
    clearMarkerEntities();
    ensureSharedHotspotMesh();

    markers.forEach((marker, index) => {
      const { entity, annotation } = createMarkerEntity(marker, index);
      markerEntities.push(entity);
      annotationScripts.push(annotation);
    });

    applySelectedIndex(selectedIndex);
  };

  rebuildMarkers();

  const placementHandle = setupEditorPlacement({
    app,
    cameraEntity,
    manager,
    createPreviewAnnotation: (entity) => entity.script.create(Annotation),
  });

  return {
    flyToMarker(index) {
      flyTo(index);
    },
    setMarkers(nextMarkers, opts) {
      const nextSelected =
        opts && "selectedIndex" in opts ? opts.selectedIndex ?? null : selectedIndex;

      const lengthChanged = markers.length !== nextMarkers.length;
      const iconChanged =
        !lengthChanged &&
        markers.some((marker, index) => marker.icon !== nextMarkers[index]?.icon);
      const positionChanged =
        !lengthChanged &&
        !iconChanged &&
        markers.some((marker, index) => {
          const other = nextMarkers[index];
          if (!other) return true;
          return (
            marker.position[0] !== other.position[0] ||
            marker.position[1] !== other.position[1] ||
            marker.position[2] !== other.position[2]
          );
        });
      const contentChanged = !markersContentEqual(markers, nextMarkers);
      const viewChanged = !markersViewEqual(markers, nextMarkers);
      const radiusChanged =
        !lengthChanged &&
        markers.some(
          (marker, index) => normalizeRadius(marker) !== normalizeRadius(nextMarkers[index]),
        );

      if (
        !lengthChanged &&
        !iconChanged &&
        !positionChanged &&
        !contentChanged &&
        !viewChanged &&
        !radiusChanged
      ) {
        if (nextSelected !== selectedIndex) {
          applySelectedIndex(nextSelected);
        }
        return;
      }

      const previousMarkers = markers;
      markers = [...nextMarkers];

      if (lengthChanged) {
        selectedIndex = nextSelected;
        const splice = findLengthSplice(previousMarkers, nextMarkers);
        if (splice?.op === "remove") {
          removeMarkerAt(splice.index);
          syncMarkerContent();
        } else if (splice?.op === "add") {
          insertMarkerAt(splice.index, nextMarkers[splice.index]);
          syncMarkerContent();
        } else {
          rebuildMarkers();
        }
        applySelectedIndex(selectedIndex);
        return;
      }

      if (positionChanged) {
        syncMarkerPositions();
      }

      if (iconChanged) {
        syncMarkerIcons();
      }

      if (contentChanged) {
        syncMarkerContent();
      }

      if (radiusChanged) {
        syncMarkerRadii();
      }

      if (nextSelected !== selectedIndex) {
        applySelectedIndex(nextSelected);
      }
    },
    setSelectedIndex(index) {
      applySelectedIndex(index);
    },
    showMarkerLabel(index) {
      const annotation = annotationScripts[index];
      if (annotation) {
        programmaticTooltipShow = true;
        try {
          manager.showTooltipFor(annotation);
        } finally {
          programmaticTooltipShow = false;
        }
      }
    },
    hideMarkerLabel() {
      manager.hideActiveTooltip();
    },
    setMarkerClickHandler(handler) {
      markerClickHandler = handler;
    },
    setPlacementPreview(state) {
      placementHandle.setPlacementPreview(state);
    },
    getPlacementPosition() {
      return placementHandle.getPlacementPosition();
    },
    getCameraPosition() {
      return placementHandle.getCameraPosition();
    },
    getMarkerPosition(index) {
      const marker = markers[index];
      if (!marker) return null;
      return [...marker.position] as [number, number, number];
    },
    getMarkerRadius(index) {
      const marker = markers[index];
      if (!marker) return null;
      return normalizeRadius(marker);
    },
    setMarkerPosition(index, position) {
      const marker = markers[index];
      if (!marker) return;
      const stored = splatEntity
        ? mapDisplayToLegacyStored(position, splatEntity)
        : position;
      markers[index] = {
        ...marker,
        position: [stored[0], stored[1], stored[2]],
      };
      const entity = markerEntities[index];
      if (entity) {
        const [x, y, z] = displayPosition(stored);
        entity.setPosition(x, y, z);
      }
    },
    setHotspotPointerEvents(index, enabled) {
      if (index === null || index < 0) return;
      const annotation = annotationScripts[index];
      if (!annotation) return;
      const resources = manager._annotationResources.get(annotation);
      if (resources?.hotspotDom) {
        resources.hotspotDom.style.pointerEvents = enabled ? "auto" : "none";
      }
    },
    destroy() {
      activeTransition?.cancel();
      placementHandle.destroy();
      clearMarkerEntities();
      managerEntity.destroy();
    },
  };
}
