// Captions live in captions.json (plain data), not here — this file is just
// the typed accessor. Previously this file WAS the data, a hand-edited object
// literal with mixed single/double-quoted entries, and three different
// scripts each re-parsed it their own fragile way (regex extraction in two
// places, a `new Function()` eval in a third). Mixed quote styles caused a
// real bug: a manual double-quoted fix silently reverted because one
// script's "is this already captioned" regex only recognised single quotes.
// Plain JSON removes that whole class of bug — every consumer just
// JSON.parses the same file.
import captionsData from './captions.json';

export type CaptionEntry = {
  title: string;
  caption: string;
  /** Registration plate, if clearly legible in the photo — powers /plate search. Not backfilled for older photos. */
  plate?: string;
};

export const captions: Record<string, CaptionEntry> = captionsData;

export function getCaption(filename: string): CaptionEntry | null {
  return captions[filename] ?? null;
}
