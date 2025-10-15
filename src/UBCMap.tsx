import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "./lib/loadGoogleMaps";

type Pin = {
  title: string;
  position: { lat: number; lng: number };
  path: string; // gaussian path (local url or cloud link)
};

export default function UBCMap({
  openViewer,
  defaultGaussianPath,
}: {
  openViewer: (path?: string) => void;
  defaultGaussianPath: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null); // holds the Map instance
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const pins: Pin[] = [
    {
      title: "UBC Main (Site A)",
      position: { lat: 49.2606, lng: -123.2460 },
      path: defaultGaussianPath,
    },
    {
      title: "UBC Field (Site B)",
      position: { lat: 49.2660, lng: -123.2450 },
      path: "/assets/gaussian_splat_data/truck/truck.ksplat",
    },
    {
      title: "UBC Point (Site C)",
      position: { lat: 49.2555, lng: -123.2400 },
      path: "/assets/gaussian_splat_data/garden/garden.ksplat",
    },
  ];

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadGoogleMaps();
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: 49.2606, lng: -123.2460 }, // UBC Vancouver
          zoom: 13,
          mapTypeId: "terrain",
          streetViewControl: false,
          fullscreenControl: true,
        });
      }

      // Cleanup any previous markers (safe if effect runs multiple times)
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];

      pins.forEach((pin) => {
        const marker = new google.maps.Marker({
          position: pin.position,
          map: mapRef.current!,
          title: pin.title,
        });

        const handleClick = () => {
          // close previous info window
          if (infoWindowRef.current) {
            infoWindowRef.current.close();
            infoWindowRef.current = null;
          }

          // build DOM node content so we can add a real button listener
          const content = document.createElement("div");
          content.style.fontFamily = "Arial, Helvetica, sans-serif";
          content.style.minWidth = "220px";
          content.innerHTML = `
            <div style="padding:8px 8px">
              <h3 style="margin:0 0 6px 0;font-size:1rem">${pin.title}</h3>
              <div style="font-size:0.85rem;margin-bottom:6px">
                <div><strong>Lat:</strong> ${pin.position.lat.toFixed(6)}</div>
                <div><strong>Lng:</strong> ${pin.position.lng.toFixed(6)}</div>
              </div>
              <div style="font-size:0.8rem;color:#555;margin-bottom:8px;word-break:break-all">
                <strong>Path:</strong> ${pin.path}
              </div>
              <div style="text-align:right">
                <button id="open-gaussian-btn" style="
                  padding: 0.45rem 0.7rem;
                  border-radius: 8px;
                  border: none;
                  cursor: pointer;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
                ">Open Gaussian</button>
              </div>
            </div>
          `;

          const infoWindow = new google.maps.InfoWindow({
            content,
            maxWidth: 360,
          });

          infoWindow.open({
            map: mapRef.current!,
            anchor: marker,
            shouldFocus: false,
          });

          // attach click handler to the button
          const btn = content.querySelector<HTMLButtonElement>("#open-gaussian-btn");
          if (btn) {
            btn.addEventListener("click", () => {
              openViewer(pin.path);
            });
          }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "60vh", borderRadius: 12 }}
    />
  );
}
