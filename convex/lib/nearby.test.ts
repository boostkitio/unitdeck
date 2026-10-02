import { describe, expect, it } from "vitest";
import {
  couldBeAE,
  describeDistance,
  isNationalRail,
  nearestFrom,
  tflService,
  type OsmElement,
} from "./nearby";

let id = 0;
function place(lat: number, lon: number, tags: Record<string, string>): OsmElement {
  id += 1;
  return { type: "node", id, lat, lon, tags };
}

// A shoot beside Woolwich Dockyard station, as the map has it.
const SHOOT = { lat: 51.4921, lng: 0.053 };
const WOOLWICH = [
  place(51.4913, 0.0546, { railway: "station", name: "Woolwich Dockyard", network: "National Rail", operator: "Southeastern" }),
  place(51.4899, 0.0691, { railway: "station", name: "Woolwich Arsenal", network: "National Rail", operator: "Southeastern" }),
  place(51.49, 0.0693, { railway: "station", name: "Woolwich Arsenal DLR", network: "Docklands Light Railway", station: "light_rail" }),
  place(51.4917, 0.071, { railway: "station", name: "Woolwich", network: "Elizabeth line", station: "subway" }),
  place(51.4787, 0.0678, { amenity: "hospital", name: "Queen Elizabeth Hospital", emergency: "yes" }),
  place(51.4862, 0.0955, { amenity: "police", name: "Plumstead Police Station" }),
];

describe("nearestFrom", () => {
  it("names the nearest National Rail station, not a better-known one further off", () => {
    const found = nearestFrom(SHOOT.lat, SHOOT.lng, WOOLWICH);
    expect(found.nearestRail).toMatch(/^Woolwich Dockyard, 0\.\d km, about \d min walk$/);
    // The DLR stop is a Tube-network station, and says so only once.
    expect(found.nearestTube).toMatch(/^Woolwich Arsenal DLR, 1\.\d km/);
    expect(found.nearestHospital).toMatch(/^Queen Elizabeth Hospital, /);
    expect(found.nearestPoliceStation).toMatch(/^Plumstead Police Station, /);
  });

  it("passes over a private hospital the map says takes emergencies", () => {
    const kent = { lat: 51.1449, lng: 0.2383 };
    const found = nearestFrom(kent.lat, kent.lng, [
      place(51.132, 0.262, { amenity: "hospital", name: "Tunbridge Wells Nuffield Hospital", emergency: "yes" }),
      place(51.148, 0.308, { amenity: "hospital", name: "Tunbridge Wells Hospital at Pembury", emergency: "yes" }),
    ]);
    expect(found.nearestHospital).toMatch(/^Tunbridge Wells Hospital at Pembury, /);
  });

  it("says when the nearest hospital is not known to have an A&E", () => {
    const found = nearestFrom(54.46, -3.09, [
      place(54.55, -3.2, { amenity: "hospital", name: "Cottage Hospital" }),
    ]);
    expect(found.nearestHospital).toMatch(/^Cottage Hospital \(check it has an A&E\), /);
  });

  it("leaves out what is not on the map rather than guessing", () => {
    expect(nearestFrom(57.05, -4.93, [])).toEqual({});
  });
});

describe("station types", () => {
  it("tells the London services apart", () => {
    expect(tflService({ network: "London Underground" })).toBe("Underground");
    expect(tflService({ network: "London Overground" })).toBe("Overground");
    expect(tflService({ network: "Docklands Light Railway" })).toBe("DLR");
    expect(tflService({ network: "Elizabeth line" })).toBe("Elizabeth line");
    expect(tflService({ network: "National Rail" })).toBeNull();
  });

  it("counts mainline stations as National Rail, and not heritage or Tube-only ones", () => {
    expect(isNationalRail({ railway: "station", network: "National Rail" })).toBe(true);
    expect(isNationalRail({ railway: "station", network: "National Rail;London Overground" })).toBe(true);
    expect(isNationalRail({ railway: "station", network: "London Underground", station: "subway" })).toBe(false);
    expect(isNationalRail({ railway: "station", usage: "tourism", operator: "Bluebell Railway" })).toBe(false);
  });

  it("knows a private hospital cannot be an A&E", () => {
    expect(couldBeAE({ name: "Spire Tunbridge Wells Hospital" })).toBe(false);
    expect(couldBeAE({ name: "Hollanden Park Hospital", "operator:type": "private" })).toBe(false);
    expect(couldBeAE({ name: "Queen Elizabeth Hospital" })).toBe(true);
  });
});

describe("describeDistance", () => {
  it("gives a walk time when it is walkable and a distance when it is not", () => {
    expect(describeDistance(400)).toBe("0.4 km, about 6 min walk");
    expect(describeDistance(3200)).toBe("3.2 km away");
    expect(describeDistance(48_600)).toBe("49 km away");
  });
});
