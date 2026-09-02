import { describe, expect, it } from "vitest";
import { NOW, applyPreset, fmtD, rangeFromDays } from "./bangkok";

describe("applyPreset d90", () => {
  it("covers the last three calendar months ending at now", () => {
    const r = applyPreset("d90");
    expect(fmtD(r.from)).toBe("2026-05-31");
    expect(r.to).toBe(NOW);
    expect(r.preset).toBe("d90");
  });
});

describe("rangeFromDays", () => {
  it("clamps a custom span longer than three months", () => {
    const r = rangeFromDays(new Date("2026-01-01T00:00:00+07:00"), new Date("2026-08-31T00:00:00+07:00"));
    expect(fmtD(r.from)).toBe("2026-05-31");
    expect(fmtD(r.to)).toBe("2026-08-31");
    expect(r.preset).toBe("custom");
  });

  it("keeps a custom span within three months", () => {
    const r = rangeFromDays(new Date("2026-07-01T00:00:00+07:00"), new Date("2026-08-31T00:00:00+07:00"));
    expect(fmtD(r.from)).toBe("2026-07-01");
    expect(fmtD(r.to)).toBe("2026-08-31");
  });
});
