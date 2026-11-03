import { describe, expect, it } from "vitest";
import { bayAreaFilterReason } from "../bayAreaFilter";

describe("recoverable Bay Area non-remote filter", () => {
  it.each(["San Francisco, CA", "San Jose, California", "Oakland", "Palo Alto", "SF Bay Area", "San Francisco Bay Area", "Walnut Creek", "Santa Rosa, CA", "San Mateo County", "San Francisco, CA / New York, NY"])("keeps local on-site and hybrid roles: %s", (location) => {
    expect(bayAreaFilterReason({ location, remoteType: "hybrid" })).toBeNull();
    expect(bayAreaFilterReason({ location, remoteType: "onsite" })).toBeNull();
  });
  it.each(["New York, NY", "Austin, TX", "Richmond, VA", "Richmond, Virginia", "Newark, NJ", "Dublin, OH", "Dublin, Ireland", "California", "United States", "", null])("hides other or unconfirmed locations: %s", (location) => {
    expect(bayAreaFilterReason({ location })).not.toBeNull();
  });
  it.each([
    { location: "San Francisco, CA", remoteType: "remote" },
    { location: "San Francisco, CA (Remote)" },
    { location: "San Jose", title: "Engineer - Remote" },
    { location: "San Mateo", remoteType: "work from home" },
  ])("hides remote even with local location: %j", (posting) => {
    expect(bayAreaFilterReason(posting)).toBe("Listed as remote");
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
