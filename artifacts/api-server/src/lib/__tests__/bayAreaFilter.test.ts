import { describe, expect, it } from "vitest";
import { bayAreaFilterReason } from "../bayAreaFilter";

describe("recoverable Bay Area or remote filter", () => {
  it.each(["San Francisco, CA", "San Jose, California", "Oakland", "Palo Alto", "SF Bay Area", "San Francisco Bay Area", "Walnut Creek", "Santa Rosa, CA", "San Mateo County", "Colma, CA", "Clayton, CA", "Monte Sereno, CA", "San Francisco, CA / New York, NY"])("keeps every local work arrangement: %s", (location) => {
    expect(bayAreaFilterReason({ location, remoteType: "hybrid" })).toBeNull();
    expect(bayAreaFilterReason({ location, remoteType: "onsite" })).toBeNull();
    expect(bayAreaFilterReason({ location, remoteType: "remote" })).toBeNull();
  });
  it.each(["New York, NY", "Austin, TX", "Richmond, VA", "Richmond, Virginia", "Newark, NJ", "Dublin, OH", "Dublin, Ireland", "Los Angeles, CA", "Seattle", "Boston"])("hides only known outside locations requiring office work: %s", (location) => {
    expect(bayAreaFilterReason({ location, remoteType: "onsite" })).not.toBeNull();
    expect(bayAreaFilterReason({ location, remoteType: "hybrid" })).not.toBeNull();
    expect(bayAreaFilterReason({ location, remoteType: "remote" })).toBeNull();
    expect(bayAreaFilterReason({ location })).toBeNull();
  });
  it.each([
    { location: "San Francisco, CA", remoteType: "remote" },
    { location: "San Francisco, CA (Remote)" },
    { location: "San Jose", title: "Engineer - Remote" },
    { location: "San Mateo", remoteType: "work from home" },
    { location: "New York, NY", remoteType: "remote" },
    { location: "Austin, TX (100% Remote)" },
    { location: "United States - Remote" },
    { location: null, title: "Engineer - Fully Remote" },
  ])("allows remote regardless of location: %j", (posting) => {
    expect(bayAreaFilterReason(posting)).toBeNull();
  });
  it.each(["California", "United States", "Unknown", "Not specified", "Various offices", "Unrecognized town", "", null])("allows uncertain locations, even for office work: %s", (location) => {
    expect(bayAreaFilterReason({ location, remoteType: "onsite" })).toBeNull();
  });
  it("does not mistake partial remote days for a fully remote role", () => {
    expect(bayAreaFilterReason({ location: "New York, NY (2 remote days)", remoteType: "hybrid" })).not.toBeNull();
  });
  it("allows conflicting fully remote evidence rather than guessing", () => {
    expect(bayAreaFilterReason({ location: "New York, NY - fully remote option", remoteType: "hybrid" })).toBeNull();
  });
  it("does not treat explicit non-remote as remote", () => {
    expect(bayAreaFilterReason({ location: "San Francisco, CA (non-remote)" })).toBeNull();
  });
  it("can be disabled without modifying job history", () => {
    const posting = { location: "New York, NY", remoteType: "remote", appliedAt: new Date(), deletedAt: null };
    const before = { ...posting };
    expect(bayAreaFilterReason(posting, { bayAreaNonRemoteOnly: false })).toBeNull();
    expect(posting).toEqual(before);
  });
});
