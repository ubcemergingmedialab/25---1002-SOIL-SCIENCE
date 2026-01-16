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
  const [pins, setPins] = useState<Pin[]>([]);

  //
  // -------------------------------------------------------------------
  // FETCH PINS (NOW AWS SIGNED REQUEST)
  // -------------------------------------------------------------------
  //
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

  //
  // -------------------------------------------------------------------
  // MAP + MARKERS (unchanged)
  // -------------------------------------------------------------------
  //
  useEffect(() => {
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

      pins.forEach((pin) => {
        const marker = new google.maps.Marker({
          position: pin.position,
          map: mapRef.current!,
          title: pin.title,
        });

        const handleClick = () => {
          if (infoWindowRef.current) {
            infoWindowRef.current.close();
            infoWindowRef.current = null;
          }

          const content = document.createElement("div");
          content.style.fontFamily = "Arial, Helvetica, sans-serif";
          content.style.minWidth = "360px";
          content.style.maxWidth = "520px";
          content.style.color = "#111827";
          content.style.overflow = "hidden";

          const card = document.createElement("div");
          card.style.display = "grid";
          card.style.gridTemplateColumns = "180px 1fr";
          card.style.gap = "20px";
          card.style.padding = "16px 20px 18px";
          card.style.alignItems = "start";

          const mediaColumn = document.createElement("div");
          mediaColumn.style.display = "flex";
          mediaColumn.style.flexDirection = "column";
          mediaColumn.style.alignItems = "center";
          mediaColumn.style.gap = "12px";

          const body = document.createElement("div");
          body.style.display = "flex";
          body.style.flexDirection = "column";
          body.style.gap = "8px";

          const title = document.createElement("h3");
          title.textContent = pin.title || "Untitled field";
          title.style.margin = "0";
          title.style.fontSize = "1.2rem";
          title.style.color = "#0f172a";
          title.style.lineHeight = "1.35";

          const coords = document.createElement("div");
          coords.style.fontSize = "0.92rem";
          coords.style.color = "#475569";
          coords.innerHTML = `
            <div><strong>Lat:</strong> ${pin.position.lat.toFixed(6)}</div>
            <div><strong>Lng:</strong> ${pin.position.lng.toFixed(6)}</div>
          `;

          const imgWrap = document.createElement("div");
          imgWrap.style.width = "100%";
          imgWrap.style.borderRadius = "12px";
          imgWrap.style.overflow = "hidden";
          imgWrap.style.boxShadow = "0 4px 16px rgba(15,23,42,0.18)";
          imgWrap.style.maxHeight = "180px";

          const img = document.createElement("img");
          img.src = pin.thumbnail || placeholderImage;
          img.alt = pin.thumbnailAlt || `${pin.title || "Field"} preview`;
          img.style.display = "block";
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "cover";
          img.style.aspectRatio = "4 / 3";
          img.loading = "lazy";

          imgWrap.appendChild(img);

          const button = document.createElement("button");
          button.id = "open-gaussian-btn";
          button.textContent = "Open 3D Viewer";
          button.style.width = "100%";
          button.style.padding = "0.55rem 1rem";
          button.style.borderRadius = "999px";
          button.style.border = "none";
          button.style.cursor = "pointer";
          button.style.background =
            "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)";
          button.style.color = "#fff";
          button.style.fontSize = "0.9rem";
          button.style.boxShadow = "0 8px 18px rgba(59,130,246,0.25)";
          button.style.fontWeight = "600";
          if (!pin.path) {
            button.style.opacity = "0.6";
            button.style.cursor = "not-allowed";
            button.disabled = true;
          }

          mediaColumn.appendChild(imgWrap);
          mediaColumn.appendChild(button);

          const desc = document.createElement("p");
          desc.textContent = pin.description?.trim()
            ? pin.description.trim()
            : "No description available yet.";
          desc.style.margin = "0";
          desc.style.fontSize = "0.95rem";
          desc.style.color = "#1f2937";
          desc.style.lineHeight = "1.55";
          desc.style.whiteSpace = "pre-wrap";
          desc.style.maxHeight = "12.5rem";
          desc.style.overflowY = "auto";
          desc.style.paddingRight = "6px";
          desc.style.marginRight = "-6px";

          body.appendChild(title);
          body.appendChild(coords);
          body.appendChild(desc);

          card.appendChild(mediaColumn);
          card.appendChild(body);
          content.appendChild(card);

          const infoWindow = new google.maps.InfoWindow({
            content,
            maxWidth: 520,
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
  }, [pins]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "60vh", borderRadius: 12 }}
    />
  );
}
