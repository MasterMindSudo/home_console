import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { CarConfig, Coordinate } from "../../../shared/types";

interface Props {
  value: CarConfig;
  activePin: "origin" | "destination";
  onActivePinChange: (pin: "origin" | "destination") => void;
  onChange: (value: CarConfig) => void;
}

function formatCoord(coord: Coordinate): string {
  return `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`;
}

function makeIcon(label: string, className: string): L.DivIcon {
  return L.divIcon({
    className: `pin-marker ${className}`,
    html: `<span><b>${label}</b></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34]
  });
}

export function CarPinMap({ value, activePin, onActivePinChange, onChange }: Props) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const originMarker = useRef<L.Marker | null>(null);
  const destinationMarker = useRef<L.Marker | null>(null);
  const activePinRef = useRef(activePin);
  const valueRef = useRef(value);

  const center = useMemo<[number, number]>(() => {
    return [
      (value.origin.lat + value.destination.lat) / 2,
      (value.origin.lng + value.destination.lng) / 2
    ];
  }, [value.origin.lat, value.origin.lng, value.destination.lat, value.destination.lng]);

  useEffect(() => {
    activePinRef.current = activePin;
  }, [activePin]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!mapElement.current || map.current) return;

    map.current = L.map(mapElement.current, {
      zoomControl: true,
      attributionControl: true
    }).setView(center, 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map.current);

    originMarker.current = L.marker([value.origin.lat, value.origin.lng], {
      icon: makeIcon("A", "origin"),
      draggable: true
    }).addTo(map.current);

    destinationMarker.current = L.marker([value.destination.lat, value.destination.lng], {
      icon: makeIcon("B", "destination"),
      draggable: true
    }).addTo(map.current);

    originMarker.current.on("dragend", () => {
      const next = originMarker.current!.getLatLng();
      onChange({ ...valueRef.current, origin: { lat: next.lat, lng: next.lng } });
    });
    destinationMarker.current.on("dragend", () => {
      const next = destinationMarker.current!.getLatLng();
      onChange({ ...valueRef.current, destination: { lat: next.lat, lng: next.lng } });
    });

    map.current.on("click", (event: L.LeafletMouseEvent) => {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (activePinRef.current === "origin") {
        onChange({ ...valueRef.current, origin: point });
      } else {
        onChange({ ...valueRef.current, destination: point });
      }
    });
  }, []);

  useEffect(() => {
    originMarker.current?.setLatLng([value.origin.lat, value.origin.lng]);
    destinationMarker.current?.setLatLng([value.destination.lat, value.destination.lng]);
    if (map.current) {
      const bounds = L.latLngBounds(
        [value.origin.lat, value.origin.lng],
        [value.destination.lat, value.destination.lng]
      );
      map.current.fitBounds(bounds.pad(0.35), { maxZoom: 14, animate: false });
    }
  }, [value.origin.lat, value.origin.lng, value.destination.lat, value.destination.lng]);

  return (
    <div className="pin-picker">
      <div className="pin-toolbar">
        <button type="button" className={activePin === "origin" ? "selected" : ""} onClick={() => onActivePinChange("origin")}>Set A</button>
        <button type="button" className={activePin === "destination" ? "selected" : ""} onClick={() => onActivePinChange("destination")}>Set B</button>
        <span>A {formatCoord(value.origin)}</span>
        <span>B {formatCoord(value.destination)}</span>
      </div>
      <div className="pin-map" ref={mapElement} />
    </div>
  );
}
