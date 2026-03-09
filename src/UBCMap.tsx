import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { awsClient } from "./lib/awsClient";
import Viewer from "./Viewer";

/* Fix default marker icon with bundlers (Leaflet expects images at root) */
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Marker.prototype.options.icon = L.icon({
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

type Pin = {
  title: string;
  position: { lat: number; lng: number };
  path: string;
  description: string;
  thumbnail: string;
  thumbnailAlt: string;
  markers?: Array<Record<string, unknown>>;
};

const placeholderImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%23202634'/%3E%3Ctext x='160' y='120' fill='%23a9b4c6' font-family='Arial' font-size='18' text-anchor='middle' dominant-baseline='middle'%3ENo image%3C/text%3E%3C/svg%3E";

const UBC_CENTER: L.LatLngTuple = [49.2606, -123.246];

function buildPopupContent(
  pin: Pin,
  onOpenViewer: () => void,
  onClosePopup: () => void
): HTMLDivElement {
  const content = document.createElement("div");
  content.className = "info-window-content";
  content.style.fontFamily = "system-ui, -apple-system, sans-serif";
  content.style.minWidth = "380px";
  content.style.maxWidth = "480px";
  content.style.overflow = "hidden";
  content.style.background = "#d4d4d8";
  content.style.borderRadius = "8px";
  content.style.border = "1px solid rgba(0, 0, 0, 0.12)";
  content.style.boxShadow = "0 12px 30px rgba(0, 0, 0, 0.2)";

  const card = document.createElement("div");
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.gap = "0";

  const imgWrap = document.createElement("div");
  imgWrap.style.width = "100%";
  imgWrap.style.height = "180px";
  imgWrap.style.overflow = "hidden";
  imgWrap.style.position = "relative";

  const img = document.createElement("img");
  img.src = pin.thumbnail || placeholderImage;
  img.alt = pin.thumbnailAlt || `${pin.title || "Field"} preview`;
  img.style.display = "block";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  img.loading = "lazy";
  imgWrap.appendChild(img);

  const body = document.createElement("div");
  body.style.padding = "1.25rem 1.5rem 1.5rem";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "0.75rem";

  const title = document.createElement("h3");
  title.textContent = pin.title || "Untitled field";
  title.style.margin = "0";
  title.style.fontSize = "1.25rem";
  title.style.color = "#222222";
  title.style.lineHeight = "1.3";
  title.style.fontWeight = "600";

  const coords = document.createElement("div");
  coords.style.fontSize = "0.85rem";
  coords.style.color = "#505050";
  coords.style.display = "flex";
  coords.style.gap = "1rem";
  coords.innerHTML = `
    <span><strong style="color:#2f2f2f">Lat:</strong> ${pin.position.lat.toFixed(5)}</span>
    <span><strong style="color:#2f2f2f">Lng:</strong> ${pin.position.lng.toFixed(5)}</span>
  `;

  const desc = document.createElement("p");
  desc.className = "info-window-desc";
  desc.textContent = pin.description?.trim()
    ? pin.description.trim()
    : "No description available yet.";
  desc.style.margin = "0";
  desc.style.fontSize = "0.9rem";
  desc.style.color = "#3a3a3a";
  desc.style.lineHeight = "1.6";
  desc.style.whiteSpace = "pre-wrap";
  desc.style.maxHeight = "6rem";
  desc.style.overflowY = "auto";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Open 3D Viewer";
  button.style.marginTop = "0.5rem";
  button.style.width = "100%";
  button.style.padding = "0.75rem 1.25rem";
  button.style.borderRadius = "6px";
  button.style.border = "none";
  button.style.cursor = "pointer";
  button.style.background = "#9fb57a";
  button.style.color = "#1d2514";
  button.style.fontSize = "0.95rem";
  button.style.fontWeight = "600";
  button.style.transition = "transform 0.15s, box-shadow 0.15s";
  button.style.boxShadow = "0 4px 10px rgba(0, 0, 0, 0.2)";
  if (!pin.path) {
    button.style.opacity = "0.5";
    button.style.cursor = "not-allowed";
    button.style.background = "#b7b7bb";
    button.style.boxShadow = "none";
    button.disabled = true;
  }
  button.onmouseenter = () => {
    if (pin.path) {
      button.style.transform = "translateY(-1px)";
      button.style.boxShadow = "0 6px 14px rgba(0, 0, 0, 0.25)";
    }
  };
  button.onmouseleave = () => {
    button.style.transform = "translateY(0)";
    button.style.boxShadow = "0 4px 10px rgba(0, 0, 0, 0.2)";
  };
  button.addEventListener("click", () => {
    if (pin.path) {
      onClosePopup();
      onOpenViewer();
    }
  });

  body.appendChild(title);
  body.appendChild(coords);
  body.appendChild(desc);
  body.appendChild(button);
  card.appendChild(imgWrap);
  card.appendChild(body);
  content.appendChild(card);
  return content;
}

export default function UBCMap({
  openViewer,
  mapLoaded,
  setMapLoaded,
  sidebarCollapsed,
  setSidebarCollapsed,
  activeViewer,
  onCloseViewer,
}: {
  openViewer: (path?: string, markers?: Array<Record<string, unknown>>) => void;
  mapLoaded: boolean;
  setMapLoaded: (loaded: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean | ((current: boolean) => boolean)) => void;
  activeViewer: { path: string; markers?: Array<Record<string, unknown>> } | null;
  onCloseViewer: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const pinToMarkerRef = useRef<Map<number, L.Marker>>(new Map());
  const [pins, setPins] = useState<Pin[]>([]);
  const [selectedPinIndex, setSelectedPinIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await awsClient.fetch(
          `${import.meta.env.VITE_API_URL}/pins`,
          { method: "GET" }
        );

        if (!res.ok) throw new Error(`Pins fetch failed: ${res.status}`);

        const data = (await res.json()) as Array<{
          title?: string;
          position?: { lat: number; lng: number };
          path?: string;
          description?: string;
          thumbnail?: string;
          thumbnailAlt?: string;
          markers?: Array<Record<string, unknown>>;
        }>;

        if (cancelled) return;

        const nextPins: Pin[] = data
          .filter((p) => p?.position?.lat && p?.position?.lng)
          .map((p) => ({
            title: p.title ?? "",
            position: { lat: p.position!.lat, lng: p.position!.lng },
            path: p.path ?? "",
            description: p.description ?? "",
            thumbnail: p.thumbnail ?? "",
            thumbnailAlt: p.thumbnailAlt ?? "",
            markers: p.markers ?? [],
          }));

        setPins(nextPins);
      } catch (err) {
        if (!cancelled) console.error("Failed to load pins", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapLoaded || !containerRef.current) return;

    const container = containerRef.current;
    const map = L.map(container, {
      center: UBC_CENTER,
      zoom: 13,
      zoomControl: false,
    });

    L.control.zoom({ position: "topright" }).addTo(map);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    mapRef.current = map;

    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];
    pinToMarkerRef.current.clear();

    pins.forEach((pin, index) => {
      const marker = L.marker([pin.position.lat, pin.position.lng])
        .addTo(map)
        .on("click", () => setSelectedPinIndex(index));

      const content = buildPopupContent(
        pin,
        () => openViewer(pin.path, pin.markers),
        () => marker.closePopup()
      );

      marker.bindPopup(content, { maxWidth: 480, minWidth: 380 });

      pinToMarkerRef.current.set(index, marker);
      markersRef.current.push(marker);
    });

    /* Re-measure after layout so Leaflet gets correct container size (no layout CSS changed) */
    const rafId = requestAnimationFrame(() => {
      map.invalidateSize();
    });

    /* ResizeObserver: when map pane resizes (e.g. sidebar toggle), tell Leaflet to re-measure */
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      markersRef.current.forEach((m) => {
        if (mapRef.current) mapRef.current.removeLayer(m);
      });
      markersRef.current = [];
      pinToMarkerRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [pins, mapLoaded, openViewer]);

  const panToWithOffset = (map: L.Map, latLng: L.LatLng) => {
    const bounds = map.getBounds();
    if (!bounds) {
      map.panTo(latLng);
      return;
    }
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const latSpan = north - south;
    const offsetLat = latLng.lat + latSpan * 0.25;
    map.panTo([offsetLat, latLng.lng]);
  };

  const runPanZoomAndOpenPopup = (map: L.Map, marker: L.Marker) => {
    const latLng = marker.getLatLng();
    map.setZoom(15);
    map.once("moveend", () => {
      panToWithOffset(map, latLng);
      map.once("moveend", () => marker.openPopup());
    });
  };

  const handlePinMenuClick = (index: number) => {
    setSelectedPinIndex(index);

    if (!mapLoaded) {
      setMapLoaded(true);
      const checkAndClick = () => {
        const marker = pinToMarkerRef.current.get(index);
        const map = mapRef.current;
        if (marker && map) {
          map.panTo(marker.getLatLng());
          map.once("moveend", () => runPanZoomAndOpenPopup(map, marker));
        } else {
          setTimeout(checkAndClick, 100);
        }
      };
      setTimeout(checkAndClick, 500);
      return;
    }

    const marker = pinToMarkerRef.current.get(index);
    const map = mapRef.current;
    if (marker && map) {
      runPanZoomAndOpenPopup(map, marker);
    }
  };

  return (
    <section className="viewerPane">
      <aside className={`sidePanel ${sidebarCollapsed ? "collapsed" : ""}`}>
        <button
          type="button"
          className="collapseToggle"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed((current) => !current)}
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>

        {!sidebarCollapsed && (
          <>
            <h2 className="sidePanelTitle">Virtual Soil Library</h2>
            <input
              type="text"
              className="locationSearch"
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {pins.length === 0 ? (
              <div className="sidePanelStatus">Loading locations...</div>
            ) : (
              <div className="sidePanelList">
                {pins
                  .map((pin, index) => ({ pin, index }))
                  .filter(({ pin }) =>
                    (pin.title || "").toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map(({ pin, index }) => (
                    <button
                      key={index}
                      className={`locationItem ${selectedPinIndex === index ? "active" : ""}`}
                      onClick={() => handlePinMenuClick(index)}
                    >
                      {pin.title || `Location ${index + 1}`}
                    </button>
                  ))}
                {pins.filter((pin) =>
                  (pin.title || "").toLowerCase().includes(searchQuery.toLowerCase())
                ).length === 0 &&
                  searchQuery && <div className="sidePanelStatus">No locations found</div>}
              </div>
            )}
          </>
        )}
      </aside>

      <div className="mapPane">
         {activeViewer && (
          <div className="embeddedViewerOverlay">
            <Viewer
              gaussianPath={activeViewer.path}
              markers={activeViewer.markers}
              onBack={onCloseViewer}
              embedded
            />
          </div>
        )}
        <div ref={containerRef} className="mapFrame" />
        {!mapLoaded && (
          <div onClick={() => setMapLoaded(true)} className="mapLoadPrompt">
            Click to load map
          </div>
        )}
       
      </div>
    </section>
  );
}
