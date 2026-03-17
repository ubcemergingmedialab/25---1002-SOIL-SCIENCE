import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "./lib/loadGoogleMaps";
import { awsClient } from "./lib/awsClient";
import Viewer from "./Viewer";

type Pin = {
  title: string;
  position: { lat: number; lng: number };
  path: string; // gaussian path (local url or cloud link)
  description: string;
  thumbnail: string;
  thumbnailAlt: string;
  markers?: Array<Record<string, unknown>>;
};

const placeholderImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='240' viewBox='0 0 320 240'%3E%3Crect width='320' height='240' fill='%23202634'/%3E%3Ctext x='160' y='120' fill='%23a9b4c6' font-family='Arial' font-size='18' text-anchor='middle' dominant-baseline='middle'%3ENo image%3C/text%3E%3C/svg%3E";

const reducedPoiStyles: google.maps.MapTypeStyle[] = [
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "poi.attraction", stylers: [{ visibility: "off" }] },
  { featureType: "transit.station", stylers: [{ visibility: "off" }] },
];

export default function UBCMap({
  openViewer,
  mapLoaded,
  setMapLoaded,
  sidebarCollapsed,
  activeViewer,
  onCloseViewer,
}: {
  openViewer: (path?: string, markers?: Array<Record<string, unknown>>) => void;
  mapLoaded: boolean;
  setMapLoaded: (loaded: boolean) => void;
  sidebarCollapsed: boolean;
  activeViewer: { path: string; markers?: Array<Record<string, unknown>> } | null;
  onCloseViewer: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const pinToMarkerRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const [pins, setPins] = useState<Pin[]>([]);
  const [selectedPinIndex, setSelectedPinIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const selectedPin = selectedPinIndex !== null ? pins[selectedPinIndex] : null;
  const filteredPins = pins
    .map((pin, index) => ({ pin, index }))
    .filter(({ pin }) => (pin.title || "").toLowerCase().includes(searchQuery.toLowerCase()));

  const smoothFocusPin = (position: google.maps.LatLngLiteral, targetZoom = 15) => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    map.panTo(position);

    const stepZoom = () => {
      const currentZoom = map.getZoom();
      if (typeof currentZoom !== "number" || currentZoom === targetZoom) return;
      const nextZoom = currentZoom < targetZoom ? currentZoom + 1 : currentZoom - 1;
      map.setZoom(nextZoom);
      if (nextZoom !== targetZoom) {
        setTimeout(stepZoom, 90);
      }
    };

    setTimeout(stepZoom, 180);
  };

  //
  // -------------------------------------------------------------------
  // FETCH PINS (NOW AWS SIGNED REQUEST)
  // -------------------------------------------------------------------
  //
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        console.log("Fetching pins..."); // debug

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

        console.log(
          "Pins loaded successfully",
          nextPins.map((pin) => ({
            title: pin.title,
            markers: pin.markers ?? [],
          }))
        ); // debug

        setPins(nextPins);
      } catch (err) {
        if (!cancelled) console.error("Failed to load pins", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  //
  // -------------------------------------------------------------------
  // MAP + MARKERS (unchanged)
  // -------------------------------------------------------------------
  //
  useEffect(() => {
    if (!mapLoaded) return;

    let cancelled = false;

    (async () => {
      await loadGoogleMaps();
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: 49.2606, lng: -123.2460 },
          zoom: 13,
          mapTypeId: "terrain",
          styles: reducedPoiStyles,
          streetViewControl: false,
          fullscreenControl: true,
        });
      }
      google.maps.event.clearListeners(mapRef.current, "click");
      mapRef.current.addListener("click", () => {
        setSelectedPinIndex(null);
        if (infoWindowRef.current) {
          infoWindowRef.current.close();
          infoWindowRef.current = null;
        }
      });

      // Cleanup previous markers
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      pinToMarkerRef.current.clear();

      pins.forEach((pin, index) => {
        const marker = new google.maps.Marker({
          position: pin.position,
          map: mapRef.current!,
          title: pin.title,
        });
        pinToMarkerRef.current.set(index, marker);

        const handleClick = () => {
          setSelectedPinIndex(index);

          if (infoWindowRef.current) {
            infoWindowRef.current.close();
            infoWindowRef.current = null;
          }

          const content = document.createElement("div");
          content.className = "info-window-content";
          content.style.fontFamily = "system-ui, -apple-system, sans-serif";
          content.style.width = "280px";
          content.style.maxWidth = "280px";
          content.style.overflow = "hidden";
          content.style.background = "#ffffff";
          content.style.borderRadius = "8px";
          content.style.border = "1px solid rgba(0, 0, 0, 0.16)";
          content.style.boxShadow = "0 4px 0 rgba(0, 0, 0, 0.16)";

          const card = document.createElement("div");
          card.style.display = "flex";
          card.style.flexDirection = "column";
          card.style.gap = "0";

          const imgWrap = document.createElement("div");
          imgWrap.style.width = "100%";
          imgWrap.style.height = "132px";
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
          body.style.padding = "0.62rem 0.72rem 0.72rem";
          body.style.display = "flex";
          body.style.flexDirection = "column";
          body.style.gap = "0.22rem";

          const title = document.createElement("h3");
          title.textContent = pin.title || "Untitled field";
          title.style.margin = "0";
          title.style.fontSize = "1.42rem";
          title.style.color = "#121212";
          title.style.lineHeight = "1.12";
          title.style.fontWeight = "600";

          const coords = document.createElement("div");
          coords.style.fontSize = "0.79rem";
          coords.style.color = "#2f2f2f";
          coords.style.display = "flex";
          coords.style.flexDirection = "column";
          coords.style.gap = "0.07rem";
          coords.style.lineHeight = "1.3";
          coords.innerHTML = `
            <span><strong style="color:#232323;font-weight:500;">Location:</strong> ${pin.title || "Unknown field"}</span>
            <span>${pin.position.lat.toFixed(4)}, ${pin.position.lng.toFixed(4)}</span>
          `;

          const button = document.createElement("button");
          button.id = "open-gaussian-btn";
          button.textContent = "→  Enter";
          button.style.marginTop = "0.38rem";
          button.style.width = "60%";
          button.style.alignSelf = "center";
          button.style.padding = "0.2rem 0.85rem 0.28rem";
          button.style.borderRadius = "999px";
          button.style.border = "none";
          button.style.cursor = "pointer";
          button.style.background = "#7b9850";
          button.style.color = "#f3f5ec";
          button.style.fontSize = "1.65rem";
          button.style.lineHeight = "1";
          button.style.fontWeight = "700";
          button.style.letterSpacing = "0.01em";
          button.style.transition = "filter 0.15s ease";
          if (!pin.path) {
            button.style.opacity = "0.5";
            button.style.cursor = "not-allowed";
            button.style.background = "#b7b7bb";
            button.disabled = true;
          }
          button.onmouseenter = () => {
            if (pin.path) {
              button.style.filter = "brightness(0.95)";
            }
          };
          button.onmouseleave = () => {
            button.style.filter = "none";
          };

          body.appendChild(title);
          body.appendChild(coords);
          body.appendChild(button);

          card.appendChild(imgWrap);
          card.appendChild(body);
          content.appendChild(card);

          const infoWindow = new google.maps.InfoWindow({
            content,
            maxWidth: 320,
            disableAutoPan: true,
          });

          infoWindow.open({
            map: mapRef.current!,
            anchor: marker,
            shouldFocus: false,
          });

          button.addEventListener("click", () => {
            if (pin.path) {
              openViewer(pin.path, pin.markers);
            }
          });

          infoWindowRef.current = infoWindow;
          smoothFocusPin(pin.position, 15);
        };

        marker.addListener("click", handleClick);
        markersRef.current.push(marker);
      });
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      pinToMarkerRef.current.clear();
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
      mapRef.current = null;
    };
  }, [pins, mapLoaded]);

  const focusPin = (index: number) => {
    const pin = pins[index];
    if (!pin) return;
    smoothFocusPin(pin.position, 15);
  };

  const handlePinMenuClick = (index: number) => {
    const triggerMarkerSelection = () => {
      const marker = pinToMarkerRef.current.get(index);
      if (!marker) return false;
      google.maps.event.trigger(marker, "click");
      return true;
    };

    if (!mapLoaded) {
      setMapLoaded(true);
      let retries = 0;
      const waitForMarker = () => {
        if (triggerMarkerSelection()) return;
        retries += 1;
        if (retries < 15) setTimeout(waitForMarker, 120);
      };
      setTimeout(waitForMarker, 450);
      return;
    }

    if (!triggerMarkerSelection()) {
      setSelectedPinIndex(index);
      focusPin(index);
    }
  };

  return (
    <section className="viewerPane">
      <aside
        className={`sidePanel mapSidePanel ${selectedPin ? "pinSelected" : ""} ${
          sidebarCollapsed ? "collapsed" : ""
        }`}
      >
        {!sidebarCollapsed && (
          <>
            {selectedPin ? (
              <section className="selectedPinCard" aria-live="polite">
                <div className="selectedPinHero">
                  <img
                    className="selectedPinImage"
                    src={selectedPin.thumbnail || placeholderImage}
                    alt={selectedPin.thumbnailAlt || `${selectedPin.title || "Field"} preview`}
                  />
                </div>
                <div className="selectedPinBody">
                  <h2>{selectedPin.title || "Untitled field"}</h2>
                  <p className="selectedPinMeta">Location: {selectedPin.title || "Unknown field"}</p>
                  <p className="selectedPinMeta">
                    {selectedPin.position.lat.toFixed(4)}, {selectedPin.position.lng.toFixed(4)}
                  </p>
                  <p className="selectedPinDescription">
                    {selectedPin.description?.trim()
                      ? selectedPin.description.trim()
                      : "No description available yet."}
                  </p>
                </div>
              </section>
            ) : (
              <>
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
                    {filteredPins.map(({ pin, index }) => (
                      <button
                        key={index}
                        className={`locationItem ${selectedPinIndex === index ? "active" : ""}`}
                        onClick={() => handlePinMenuClick(index)}
                      >
                        {pin.title || `Location ${index + 1}`}
                      </button>
                    ))}
                    {filteredPins.length === 0 && searchQuery && (
                      <div className="sidePanelStatus">No locations found</div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </aside>

      <div className="mapPane">
        <div ref={containerRef} className="mapFrame" />
        {!mapLoaded && (
          <div onClick={() => setMapLoaded(true)} className="mapLoadPrompt">
            Click to load map
          </div>
        )}
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
      </div>
    </section>
  );
}
