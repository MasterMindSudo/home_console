import { FormEvent, useEffect, useState } from "react";
import { BusDirectionChoice, BusRouteChoice, BusStopChoice, CommuteProfile, MtrStationChoice, ProfileInput } from "../../../shared/types";
import { api } from "../lib/api";
import { CarPinMap } from "./CarPinMap";

const emptyInput: ProfileInput = {
  name: "GF morning work",
  latestArrivalTime: "08:55",
  bus: {
    operator: "KMB",
    operators: ["KMB"],
    route: "",
    direction: "outbound",
    serviceType: "1",
    originStopId: "",
    destinationStopId: ""
  },
  mtr: {
    line: "",
    station: "",
    direction: "UP",
    averageRideMinutes: 0,
    startStationCode: "",
    endStationCode: ""
  },
  car: {
    origin: { lat: 22.3027, lng: 114.1772 },
    destination: { lat: 22.2819, lng: 114.1589 }
  },
  tunnelIndicatorId: ""
};

interface Props {
  profile?: CommuteProfile;
  onSave: (input: ProfileInput) => Promise<void>;
}

export function ProfileForm({ profile, onSave }: Props) {
  const [input, setInput] = useState<ProfileInput>(() => profile || emptyInput);
  const [routeQuery, setRouteQuery] = useState(profile?.bus?.route || "");
  const [routeChoices, setRouteChoices] = useState<BusRouteChoice[]>([]);
  const [directionChoices, setDirectionChoices] = useState<BusDirectionChoice[]>([]);
  const [stopChoices, setStopChoices] = useState<BusStopChoice[]>([]);
  const [loadingBus, setLoadingBus] = useState("");
  const [mtrStations, setMtrStations] = useState<MtrStationChoice[]>([]);
  const [loadingMtr, setLoadingMtr] = useState("");
  const [activeCarPin, setActiveCarPin] = useState<"origin" | "destination">("origin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    if (routeQuery.trim().length < 1) {
      setRouteChoices([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoadingBus("routes");
      api.searchBusRoutes(routeQuery)
        .then(setRouteChoices)
        .catch((err) => setError(err instanceof Error ? err.message : "Could not load bus routes."))
        .finally(() => setLoadingBus(""));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [routeQuery]);

  useEffect(() => {
    const route = input.bus?.route;
    if (!route) {
      setDirectionChoices([]);
      setStopChoices([]);
      return;
    }
    setLoadingBus("directions");
    api.busDirections(route)
      .then((choices) => {
        setDirectionChoices(choices);
        const currentDirection =
          choices.find((choice) => {
            const choiceOperators = choice.operators.join(",");
            const currentOperators = (input.bus?.operators || []).join(",");
            return choice.direction === input.bus?.direction && choiceOperators === currentOperators;
          }) || choices[0];
        if (currentDirection && (!input.bus?.operatorDirections || !Object.keys(input.bus.operatorDirections).length)) {
          update("bus", {
            ...input.bus!,
            direction: currentDirection.direction,
            operators: currentDirection.operators,
            operatorDirections: currentDirection.operatorDirections,
            operator: currentDirection.operators[0],
            serviceType: currentDirection.serviceType || input.bus?.serviceType || "1",
            originStopId: "",
            destinationStopId: "",
            originStopIds: {},
            destinationStopIds: {},
            originStopName: "",
            destinationStopName: ""
          });
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load directions."))
      .finally(() => setLoadingBus(""));
  }, [input.bus?.route]);

  useEffect(() => {
    const bus = input.bus;
    if (!bus?.route || !bus.direction || !bus.operators?.length) {
      setStopChoices([]);
      return;
    }
    setLoadingBus("stops");
    api.busStops(bus.route, bus.direction, bus.operators, bus.serviceType, bus.operatorDirections)
      .then(setStopChoices)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load stops."))
      .finally(() => setLoadingBus(""));
  }, [input.bus?.route, input.bus?.direction, input.bus?.operators?.join(","), input.bus?.serviceType, JSON.stringify(input.bus?.operatorDirections || {})]);

  useEffect(() => {
    setLoadingMtr("stations");
    api.allMtrStations()
      .then(setMtrStations)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load MTR stations."))
      .finally(() => setLoadingMtr(""));
  }, []);

  useEffect(() => {
    const mtr = input.mtr;
    if (!mtr?.startStationCode || !mtr.endStationCode || mtr.startStationCode === mtr.endStationCode) return;
    setLoadingMtr("trip");
    api.mtrTrip(mtr.startStationCode, mtr.endStationCode)
      .then((trip) => update("mtr", trip))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not resolve MTR trip."))
      .finally(() => setLoadingMtr(""));
  }, [input.mtr?.startStationCode, input.mtr?.endStationCode]);

  function chooseRoute(route: BusRouteChoice) {
    update("bus", {
      ...input.bus!,
      route: route.route,
      operators: route.operators,
      operator: route.operators[0],
      direction: "outbound",
      operatorDirections: {},
      originStopId: "",
      destinationStopId: "",
      originStopIds: {},
      destinationStopIds: {},
      originStopName: "",
      destinationStopName: ""
    });
    setRouteQuery(route.route);
  }

  function chooseDirection(direction: BusDirectionChoice) {
    update("bus", {
      ...input.bus!,
      direction: direction.direction,
      operators: direction.operators,
      operatorDirections: direction.operatorDirections,
      operator: direction.operators[0],
      serviceType: direction.serviceType || input.bus?.serviceType || "1",
      originStopId: "",
      destinationStopId: "",
      originStopIds: {},
      destinationStopIds: {},
      originStopName: "",
      destinationStopName: ""
    });
  }

  function chooseStop(kind: "origin" | "destination", key: string) {
    const stop = stopChoices.find((choice) => choice.key === key);
    if (!stop) return;
    const firstStopId = Object.values(stop.stopIds)[0] || "";
    update("bus", {
      ...input.bus!,
      [`${kind}StopId`]: firstStopId,
      [`${kind}StopIds`]: stop.stopIds,
      [`${kind}StopName`]: stop.name
    } as ProfileInput["bus"]);
  }

  function selectedStopKey(kind: "origin" | "destination"): string {
    const bus = input.bus;
    if (!bus) return "";
    const stopId = kind === "origin" ? bus.originStopId : bus.destinationStopId;
    const stopName = kind === "origin" ? bus.originStopName : bus.destinationStopName;
    return stopChoices.find((stop) => stop.name === stopName || Object.values(stop.stopIds).includes(stopId))?.key || "";
  }

  function selectedDirectionIndex(): number {
    const bus = input.bus;
    if (!bus) return 0;
    const index = directionChoices.findIndex((choice) => {
      return (
        choice.direction === bus.direction &&
        choice.serviceType === bus.serviceType &&
        choice.operators.join(",") === (bus.operators || []).join(",")
      );
    });
    return index >= 0 ? index : 0;
  }

  const selectedOrigin = stopChoices.find((stop) => stop.key === selectedStopKey("origin"));
  const destinationChoices = selectedOrigin ? stopChoices.filter((stop) => stop.sequence > selectedOrigin.sequence) : stopChoices;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="setup-panel" onSubmit={submit}>
      <div className="section-heading">
        <h2>{profile ? "Edit commute" : "New commute"}</h2>
        <button type="submit" disabled={saving}>{saving ? "Saving" : "Save"}</button>
      </div>

      <label>
        Profile name
        <input value={input.name} onChange={(event) => update("name", event.target.value)} />
      </label>
      <label>
        Latest arrival
        <input type="time" value={input.latestArrivalTime} onChange={(event) => update("latestArrivalTime", event.target.value)} />
      </label>

      <fieldset>
        <legend>Bus</legend>
        <div className="grid-two">
          <label>
            Route
            <input list="bus-routes" value={routeQuery} onChange={(event) => setRouteQuery(event.target.value.toUpperCase())} placeholder="e.g. 101" />
            <datalist id="bus-routes">
              {routeChoices.map((route) => <option key={route.route} value={route.route}>{route.operators.join(" + ")}</option>)}
            </datalist>
          </label>
          <label>
            Select route
            <select value={input.bus?.route || ""} onChange={(event) => {
              const route = routeChoices.find((choice) => choice.route === event.target.value);
              if (route) chooseRoute(route);
            }}>
              <option value="">Choose route</option>
              {routeChoices.map((route) => <option key={route.route} value={route.route}>{route.route} · {route.operators.join(" + ")}</option>)}
            </select>
          </label>
          <label>
            Direction
            <select value={selectedDirectionIndex()} onChange={(event) => {
              const direction = directionChoices[Number(event.target.value)];
              if (direction) chooseDirection(direction);
            }}>
              {directionChoices.map((direction, index) => (
                <option key={`${direction.origin}-${direction.destination}-${index}`} value={index}>
                  {direction.origin} to {direction.destination} · {direction.operators.join(" + ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Operators
            <input value={input.bus?.operators?.join(" + ") || input.bus?.operator || ""} readOnly />
          </label>
          <label>
            Origin stop
            <select value={selectedStopKey("origin")} onChange={(event) => chooseStop("origin", event.target.value)}>
              <option value="">Choose origin stop</option>
              {stopChoices.map((stop) => <option key={`origin-${stop.key}`} value={stop.key}>{stop.sequence}. {stop.name} · {stop.operators.join(" + ")}</option>)}
            </select>
          </label>
          <label>
            Destination stop
            <select value={selectedStopKey("destination")} onChange={(event) => chooseStop("destination", event.target.value)}>
              <option value="">Choose destination stop</option>
              {destinationChoices.map((stop) => <option key={`dest-${stop.key}`} value={stop.key}>{stop.sequence}. {stop.name} · {stop.operators.join(" + ")}</option>)}
            </select>
          </label>
        </div>
        {loadingBus && <p className="muted">Loading bus {loadingBus}...</p>}
      </fieldset>

      <fieldset>
        <legend>MTR</legend>
        <div className="grid-two">
          <label>
            Start station
            <select value={input.mtr?.startStationCode || input.mtr?.station || ""} onChange={(event) => {
              const station = mtrStations.find((item) => item.code === event.target.value);
              update("mtr", { ...input.mtr!, station: event.target.value, startStationCode: event.target.value, startStationName: station?.name || "", endStationCode: "", endStationName: "", averageRideMinutes: 0, routeSummary: "" });
            }}>
              <option value="">Choose start station</option>
              {mtrStations.map((station) => <option key={`start-${station.code}`} value={station.code}>{station.name} - {station.lines.join(" / ")}</option>)}
            </select>
          </label>
          <label>
            End station
            <select value={input.mtr?.endStationCode || ""} onChange={(event) => {
              const station = mtrStations.find((item) => item.code === event.target.value);
              update("mtr", { ...input.mtr!, endStationCode: event.target.value, endStationName: station?.name || "" });
            }}>
              <option value="">Choose end station</option>
              {mtrStations.filter((station) => station.code !== (input.mtr?.startStationCode || input.mtr?.station)).map((station) => <option key={`end-${station.code}`} value={station.code}>{station.name} - {station.lines.join(" / ")}</option>)}
            </select>
          </label>
          <label>
            Estimated ride minutes
            <input value={input.mtr?.averageRideMinutes ? `${input.mtr.averageRideMinutes} min - ${input.mtr.routeSummary || input.mtr.line}` : ""} readOnly />
          </label>
        </div>
        {loadingMtr && <p className="muted">Loading MTR {loadingMtr}...</p>}
      </fieldset>

      <fieldset>
        <legend>Car pins</legend>
        <CarPinMap
          value={input.car!}
          activePin={activeCarPin}
          onActivePinChange={setActiveCarPin}
          onChange={(car) => update("car", car)}
        />
      </fieldset>

      <label>
        Tunnel indicator ID
        <input value={input.tunnelIndicatorId || ""} onChange={(event) => update("tunnelIndicatorId", event.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

