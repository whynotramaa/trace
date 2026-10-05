/*
 * Port of Apache Lucene's org.apache.lucene.analysis.en.PorterStemmer.java.
 *
 * Copyright 2001-2025 The Apache Software Foundation.
 * Licensed under the Apache License, Version 2.0:
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * The algorithm is Porter's original 1980 suffix-stripping algorithm.
 */

export function porterStem(input: string): string {
  if (input.length <= 2) return input;

  const b = input.split("");
  let j = 0;
  let k = b.length - 1;
  const k0 = 0;

  const consonant = (index: number): boolean => {
    switch (b[index]) {
      case "a":
      case "e":
      case "i":
      case "o":
      case "u":
        return false;
      case "y":
        return index === k0 ? true : !consonant(index - 1);
      default:
        return true;
    }
  };

  const measure = (): number => {
    let count = 0;
    let index = k0;
    while (true) {
      if (index > j) return count;
      if (!consonant(index)) break;
      index++;
    }
    index++;
    while (true) {
      while (true) {
        if (index > j) return count;
        if (consonant(index)) break;
        index++;
      }
      index++;
      count++;
      while (true) {
        if (index > j) return count;
        if (!consonant(index)) break;
        index++;
      }
      index++;
    }
  };

  const vowelInStem = (): boolean => {
    for (let index = k0; index <= j; index++) if (!consonant(index)) return true;
    return false;
  };

  const doubleConsonant = (index: number): boolean =>
    index >= k0 + 1 && b[index] === b[index - 1] && consonant(index);

  const cvc = (index: number): boolean => {
    if (index < k0 + 2 || !consonant(index) || consonant(index - 1) || !consonant(index - 2)) return false;
    return b[index] !== "w" && b[index] !== "x" && b[index] !== "y";
  };

  const ends = (suffix: string): boolean => {
    const start = k - suffix.length + 1;
    if (start < k0 || b.slice(start, k + 1).join("") !== suffix) return false;
    j = k - suffix.length;
    return true;
  };

  const setTo = (suffix: string): void => {
    for (let index = 0; index < suffix.length; index++) b[j + 1 + index] = suffix.charAt(index);
    k = j + suffix.length;
  };

  const replaceIfMeasured = (suffix: string): void => {
    if (measure() > 0) setTo(suffix);
  };

  // Step 1: plurals and -ed/-ing.
  if (b[k] === "s") {
    if (ends("sses")) k -= 2;
    else if (ends("ies")) setTo("i");
    else if (b[k - 1] !== "s") k--;
  }
  if (ends("eed")) {
    if (measure() > 0) k--;
  } else if ((ends("ed") || ends("ing")) && vowelInStem()) {
    k = j;
    if (ends("at")) setTo("ate");
    else if (ends("bl")) setTo("ble");
    else if (ends("iz")) setTo("ize");
    else if (doubleConsonant(k)) {
      const ch = b[k--];
      if (ch === "l" || ch === "s" || ch === "z") k++;
    } else if (measure() === 1 && cvc(k)) setTo("e");
  }

  // Step 2: terminal y -> i.
  if (ends("y") && vowelInStem()) b[k] = "i";

  // Step 3: double suffixes -> single suffixes.
  if (k !== k0) {
    switch (b[k - 1]) {
      case "a":
        if (ends("ational")) replaceIfMeasured("ate");
        else if (ends("tional")) replaceIfMeasured("tion");
        break;
      case "c":
        if (ends("enci")) replaceIfMeasured("ence");
        else if (ends("anci")) replaceIfMeasured("ance");
        break;
      case "e":
        if (ends("izer")) replaceIfMeasured("ize");
        break;
      case "l":
        if (ends("bli")) replaceIfMeasured("ble");
        else if (ends("alli")) replaceIfMeasured("al");
        else if (ends("entli")) replaceIfMeasured("ent");
        else if (ends("eli")) replaceIfMeasured("e");
        else if (ends("ousli")) replaceIfMeasured("ous");
        break;
      case "o":
        if (ends("ization")) replaceIfMeasured("ize");
        else if (ends("ation")) replaceIfMeasured("ate");
        else if (ends("ator")) replaceIfMeasured("ate");
        break;
      case "s":
        if (ends("alism")) replaceIfMeasured("al");
        else if (ends("iveness")) replaceIfMeasured("ive");
        else if (ends("fulness")) replaceIfMeasured("ful");
        else if (ends("ousness")) replaceIfMeasured("ous");
        break;
      case "t":
        if (ends("aliti")) replaceIfMeasured("al");
        else if (ends("iviti")) replaceIfMeasured("ive");
        else if (ends("biliti")) replaceIfMeasured("ble");
        break;
      case "g":
        if (ends("logi")) replaceIfMeasured("log");
        break;
    }
  }

  // Step 4: -ic-, -full, -ness, and similar suffixes.
  switch (b[k]) {
    case "e":
      if (ends("icate")) replaceIfMeasured("ic");
      else if (ends("ative")) replaceIfMeasured("");
      else if (ends("alize")) replaceIfMeasured("al");
      break;
    case "i":
      if (ends("iciti")) replaceIfMeasured("ic");
      break;
    case "l":
      if (ends("ical")) replaceIfMeasured("ic");
      else if (ends("ful")) replaceIfMeasured("");
      break;
    case "s":
      if (ends("ness")) replaceIfMeasured("");
      break;
  }

  // Step 5: terminal suffixes in a stem with measure > 1.
  if (k !== k0) {
    let matched = false;
    switch (b[k - 1]) {
      case "a": matched = ends("al"); break;
      case "c": matched = ends("ance") || ends("ence"); break;
      case "e": matched = ends("er"); break;
      case "i": matched = ends("ic"); break;
      case "l": matched = ends("able") || ends("ible"); break;
      case "n": matched = ends("ant") || ends("ement") || ends("ment") || ends("ent"); break;
      case "o": matched = (ends("ion") && j >= 0 && (b[j] === "s" || b[j] === "t")) || ends("ou"); break;
      case "s": matched = ends("ism"); break;
      case "t": matched = ends("ate") || ends("iti"); break;
      case "u": matched = ends("ous"); break;
      case "v": matched = ends("ive"); break;
      case "z": matched = ends("ize"); break;
    }
    if (matched && measure() > 1) k = j;
  }

  // Step 6: final -e and -ll.
  j = k;
  if (b[k] === "e") {
    const count = measure();
    if (count > 1 || (count === 1 && !cvc(k - 1))) k--;
  }
  if (b[k] === "l" && doubleConsonant(k) && measure() > 1) k--;

  return b.slice(0, k + 1).join("");
}
