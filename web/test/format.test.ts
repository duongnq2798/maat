import { describe, expect, it } from "vitest";
import { clockLabel, dayLabel, formatInt, numberWord } from "@/content/format";

describe("format", () => {
  it("groups thousands like the comp", () => {
    expect(formatInt(53_551_627)).toBe("53,551,627");
    expect(formatInt(111_116)).toBe("111,116");
  });

  it("spells the counts the copy spells out, and refuses the rest", () => {
    expect(numberWord(9)).toBe("Nine");
    expect(numberWord(19)).toBe("Nineteen");
    expect(() => numberWord(20)).toThrow(/update the copy/);
  });

  it("labels days the way the ledger does", () => {
    expect(dayLabel("2026-11-05")).toBe("Thu 5 Nov");
    expect(dayLabel("2026-11-05", 2)).toBe("Sat 7 Nov");
    expect(() => dayLabel("not-a-date")).toThrow();
  });

  it("labels minutes after midnight as a zero-padded 24 h clock", () => {
    expect(clockLabel(570)).toBe("09:30");
    expect(clockLabel(960)).toBe("16:00");
    expect(clockLabel(1200)).toBe("20:00");
    expect(clockLabel(0)).toBe("00:00");
    expect(clockLabel(1439)).toBe("23:59");
  });

  it("refuses minutes that are not a time of day", () => {
    expect(() => clockLabel(1440)).toThrow();
    expect(() => clockLabel(9.5)).toThrow();
    expect(() => clockLabel(-1)).toThrow();
  });
});
