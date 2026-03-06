import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "./lib/loadGoogleMaps";
import { awsClient } from "./lib/awsClient";

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

export default function UBCMap({
  openViewer,
  mapLoaded,
  setMapLoaded,
  sidebarCollapsed,
  setSidebarCollapsed,
}: {
  openViewer: (path?: string, markers?: Array<Record<string, unknown>>) => void;
  mapLoaded: boolean;
  setMapLoaded: (loaded: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean | ((current: boolean) => boolean)) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const pinToMarkerRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const [pins, setPins] = useState<Pin[]>([]);
  const [selectedPinIndex, setSelectedPinIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
          streetViewControl: false,
          fullscreenControl: true,
        });
      }

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

          // Image section at top
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

          // Content body
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
          button.id = "open-gaussian-btn";
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

          body.appendChild(title);
          body.appendChild(coords);
          body.appendChild(desc);
          body.appendChild(button);

          card.appendChild(imgWrap);
          card.appendChild(body);
          content.appendChild(card);

          const infoWindow = new google.maps.InfoWindow({
            content,
            maxWidth: 480,
            disableAutoPan: true,
          });

          infoWindow.open({
            map: mapRef.current!,
            anchor: marker,
            shouldFocus: false,
          });

          button.addEventListener("click", () => {
            if (pin.path) openViewer(pin.path, pin.markers);
          });

          infoWindowRef.current = infoWindow;
        };

        marker.addListener("click", handleClick);
        markersRef.current.push(marker);
      });
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
      mapRef.current = null;
    };
  }, [pins, mapLoaded]);

  // Helper to pan with the pin in the lower portion of the viewport (leaving room for InfoWindow)
  const panToWithOffset = (map: google.maps.Map, position: google.maps.LatLng) => {
    const bounds = map.getBounds();
    if (!bounds) {
      map.panTo(position);
      return;
    }
    // Calculate the vertical span and offset the center so pin is in lower 1/3 of viewport
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const latSpan = ne.lat() - sw.lat();
    // Offset center northward so pin appears lower
    const offsetLat = position.lat() + latSpan * 0.25;
    map.panTo({ lat: offsetLat, lng: position.lng() });
  };

  const handlePinMenuClick = (index: number) => {
    setSelectedPinIndex(index);
    
    // If map isn't loaded, load it first
    if (!mapLoaded) {
      setMapLoaded(true);
      // Wait for map and markers to be ready
      const checkAndClick = () => {
        const marker = pinToMarkerRef.current.get(index);
        if (marker && mapRef.current) {
          const position = marker.getPosition()!;
          // First pan to the marker area
          mapRef.current.panTo(position);
          // Wait for pan to complete, then zoom and trigger click
          google.maps.event.addListenerOnce(
            mapRef.current,
            "idle",
            () => {
              mapRef.current!.setZoom(15);
              // Wait for zoom to complete, then offset pan and trigger click
              google.maps.event.addListenerOnce(mapRef.current!, "idle", () => {
                panToWithOffset(mapRef.current!, position);
                google.maps.event.addListenerOnce(mapRef.current!, "idle", () => {
                  google.maps.event.trigger(marker, "click");
                });
              });
            }
          );
        } else {
          // Retry after a short delay if markers aren't ready yet
          setTimeout(checkAndClick, 100);
        }
      };
      setTimeout(checkAndClick, 500);
      return;
    }

    const marker = pinToMarkerRef.current.get(index);
    if (marker && mapRef.current) {
      const position = marker.getPosition()!;
      // First zoom, then offset pan
      mapRef.current.setZoom(15);
      google.maps.event.addListenerOnce(mapRef.current, "idle", () => {
        panToWithOffset(mapRef.current!, position);
        // Wait for offset pan to complete, then trigger click
        google.maps.event.addListenerOnce(mapRef.current!, "idle", () => {
          google.maps.event.trigger(marker, "click");
        });
      });
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
        <div
          ref={containerRef}
          className="mapFrame"
        />
        {!mapLoaded && (
          <div
            onClick={() => setMapLoaded(true)}
            className="mapLoadPrompt"
          >
            Click to load map
          </div>
        )}
      </div>
    </section>
  );
}
