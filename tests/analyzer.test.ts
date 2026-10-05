import { describe, expect, test } from "bun:test";
import { analyze } from "../engine/analyzer.ts";
import { porterStem } from "../engine/porter.ts";

describe("Porter / Lucene analyzer", () => {
  test("ports the Lucene Porter algorithm", () => {
    expect([
      "caresses", "ponies", "ties", "cats", "feed", "agreed", "disabled", "matting", "mating",
      "meeting", "milling", "messing", "meetings", "relational", "conditional", "rational",
    ].map(porterStem)).toEqual([
      "caress", "poni", "ti", "cat", "feed", "agre", "disabl", "mat", "mate", "meet", "mill",
      "mess", "meet", "relat", "condit", "ration",
    ]);
  });

  test("matches the DefaultEnglishAnalyzer pipeline for stable UAX-29 cases", () => {
    expect(analyze("The QUICK fox's 123.45 naïve 中文 日本語.")).toEqual([
      "quick", "fox", "123.45", "naïv", "中", "文", "日", "本", "語",
    ]);
    expect(analyze("١٢٣٫٤٥ １２３．４５ O’Reilly dogs’s")).toEqual([
      "١٢٣٫٤٥", "１２３．４５", "o’reilli", "dog",
    ]);
    expect(analyze("and the of in to was will")).toEqual([]);
  });

  test("technical mode retains programming tokens and source spelling", () => {
    expect(analyze("C++ C# snake_case camelCase v1.2.3 java.util.List src/foo.ts", "technical")).toEqual([
      "C++", "C#", "snake_case", "camelCase", "v1.2.3", "java.util.List", "src/foo.ts",
    ]);
  });

  // Lucene currently pins Unicode 12.1 while Bun delegates segmentation to
  // its ICU build; future Unicode data can legitimately expose discrepancies.
  test("does not fall back to ASCII-only splitting", () => {
    expect(analyze("café Ελληνικά 한국어 ไทย 👩‍💻")).toEqual([
      "café", "ελληνικά", "한국어", "ไทย", "👩‍💻",
    ]);
  });
});
