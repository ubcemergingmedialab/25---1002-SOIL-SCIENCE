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
}: {
  openViewer: (path?: string, markers?: Array<Record<string, unknown>>) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const pinToMarkerRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const [pins, setPins] = useState<Pin[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [selectedPinIndex, setSelectedPinIndex] = useState<number | null>(null);

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
          content.style.background = "#1a1f2e";
          content.style.borderRadius = "8px";
          content.style.border = "1px solid rgba(255, 255, 255, 0.1)";
          content.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.5)";

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
          title.style.color = "#e6edf3";
          title.style.lineHeight = "1.3";
          title.style.fontWeight = "600";

          const coords = document.createElement("div");
          coords.style.fontSize = "0.85rem";
          coords.style.color = "#9aa4b5";
          coords.style.display = "flex";
          coords.style.gap = "1rem";
          coords.innerHTML = `
            <span><strong style="color:#b8c2d1">Lat:</strong> ${pin.position.lat.toFixed(5)}</span>
            <span><strong style="color:#b8c2d1">Lng:</strong> ${pin.position.lng.toFixed(5)}</span>
          `;

          const desc = document.createElement("p");
          desc.className = "info-window-desc";
          desc.textContent = pin.description?.trim()
            ? pin.description.trim()
            : "No description available yet.";
          desc.style.margin = "0";
          desc.style.fontSize = "0.9rem";
          desc.style.color = "#b8c2d1";
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
          button.style.background = "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)";
          button.style.color = "#fff";
          button.style.fontSize = "0.95rem";
          button.style.fontWeight = "600";
          button.style.transition = "transform 0.15s, box-shadow 0.15s";
          button.style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.3)";
          if (!pin.path) {
            button.style.opacity = "0.5";
            button.style.cursor = "not-allowed";
            button.style.background = "#3a4255";
            button.style.boxShadow = "none";
            button.disabled = true;
          }
          button.onmouseenter = () => {
            if (pin.path) {
              button.style.transform = "translateY(-1px)";
              button.style.boxShadow = "0 6px 20px rgba(59, 130, 246, 0.4)";
            }
          };
          button.onmouseleave = () => {
            button.style.transform = "translateY(0)";
            button.style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.3)";
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
          // First pan to the marker
          mapRef.current.panTo(position);
          // Wait for pan to complete, then zoom and trigger click
          const idleListener = google.maps.event.addListenerOnce(
            mapRef.current,
            "idle",
            () => {
              mapRef.current!.setZoom(15);
              // Wait for zoom to complete, then trigger click
              google.maps.event.addListenerOnce(mapRef.current!, "idle", () => {
                google.maps.event.trigger(marker, "click");
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
      // First pan to the marker
      mapRef.current.panTo(position);
      // Wait for pan to complete, then zoom and trigger click
      google.maps.event.addListenerOnce(mapRef.current, "idle", () => {
        mapRef.current!.setZoom(15);
        // Wait for zoom to complete, then trigger click
        google.maps.event.addListenerOnce(mapRef.current!, "idle", () => {
          google.maps.event.trigger(marker, "click");
        });
      });
    }
  };

  return (
    <div style={{ width: "min(1100px, 100%)", margin: "0 auto", display: "flex", gap: "1rem", alignItems: "flex-start" }}>
      {/* Side Menu */}
      <aside
        style={{
          width: "240px",
          flexShrink: 0,
          backgroundColor: "#1a1f2e",
          borderRadius: 6,
          padding: "1rem",
          maxHeight: "60vh",
          overflowY: "auto",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}
      >
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", color: "#e6edf3", fontWeight: 600 }}>
          Locations
        </h3>
        {pins.length === 0 ? (
          <div style={{ color: "#9aa4b5", fontSize: "0.9rem", padding: "1rem 0" }}>
            Loading locations...
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {pins.map((pin, index) => (
              <button
                key={index}
                className="location-btn"
                onClick={() => handlePinMenuClick(index)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "4px",
                  border: "none",
                  backgroundColor: selectedPinIndex === index ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.04)",
                  color: selectedPinIndex === index ? "#fff" : "#b8c2d1",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "0.875rem",
                  fontWeight: selectedPinIndex === index ? 500 : 400,
                  transition: "background-color 0.15s, color 0.15s",
                  outline: "none",
                  boxShadow: "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  if (selectedPinIndex !== index) {
                    e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.04)";
                    e.currentTarget.style.color = "#b8c2d1";
                  } else {
                    e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
                  }
                }}
              >
                {pin.title || `Location ${index + 1}`}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Map Container */}
      <div
        style={{
          flex: 1,
          height: "60vh",
          borderRadius: 6,
          position: "relative",
          minWidth: 0,
        }}
      >
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", borderRadius: 6 }}
        />
        {!mapLoaded && (
          <div
            onClick={() => setMapLoaded(true)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              backgroundColor: "#4a5568",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              userSelect: "none",
              color: "#e2e8f0",
              fontSize: "1.25rem",
              fontWeight: 500,
              transition: "background-color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#5a6578";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#4a5568";
            }}
          >
            Click to load map
          </div>
        )}
      </div>
    </div>
  );
}
