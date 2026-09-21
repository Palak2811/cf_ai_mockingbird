import { describe, expect, it } from "vitest";
import { extractJson } from "../src/server/llm";
import { asEvaluation, asGaps, asProfile, asQuestions } from "../src/server/validate";

describe("extractJson", () => {
  it("parses JSON wrapped in prose and code fences", () => {
    expect(extractJson('Sure! ```json\n{"a": {"b": "}"}}\n``` done')).toEqual({ a: { b: "}" } });
  });
  it("throws on missing or truncated JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
    expect(() => extractJson('{"a": 1')).toThrow();
  });
});

describe("validators", () => {
  it("normalises a profile and clamps weights", () => {
    const p = asProfile({ role: " SWE ", competencies: [{ name: "TS", weight: 9, why: "x" }, { name: "" }] });
    expect(p.role).toBe("SWE");
    expect(p.seniority).toBe("Unknown");
    expect(p.competencies).toEqual([{ name: "TS", weight: 5, why: "x" }]);
  });
  it("rejects a profile without competencies (forces a workflow retry)", () => {
    expect(() => asProfile({ role: "SWE", competencies: [] })).toThrow();
  });
  it("defaults unknown gap priorities", () => {
    expect(asGaps({ gaps: [{ skill: "Rust", priority: "urgent", advice: "a" }] }).gaps[0].priority).toBe("medium");
    expect(() => asGaps({ gaps: [] })).toThrow();
  });
  it("assigns sequential ids after filtering bad questions", () => {
    const qs = asQuestions({
      questions: [
        { prompt: "short" },
        { prompt: "Explain how Durable Objects give strong consistency", type: "technical", lookFor: ["a"] },
        { prompt: "Tell me about a time you shipped under pressure", type: "weird" },
        { prompt: "Design a globally distributed rate limiter", type: "design" },
      ],
    });
    expect(qs.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(qs[1].type).toBe("technical");
    expect(() => asQuestions({ questions: [{ prompt: "Only one good question here" }] })).toThrow();
  });
  it("clamps evaluation scores and accepts numeric strings", () => {
    expect(asEvaluation({ score: "7", verdict: "ok" }).score).toBe(5);
    expect(asEvaluation({}).score).toBe(0);
  });
});
