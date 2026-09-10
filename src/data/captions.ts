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
  /**
   * Registration plate(s), if clearly legible in the photo — powers /plate
   * search. Comma-separated when a photo shows more than one car with a
   * legible plate (e.g. "141-D-12345, WV05 APZ"). Not backfilled for older
   * photos.
   */
  plate?: string;
};

export const captions: Record<string, CaptionEntry> = captionsData;

export function getCaption(filename: string): CaptionEntry | null {
  return captions[filename] ?? null;
}

export type PlateEntry = { filename: string; plate: string; title: string; slug: string };

// Shared by /plate and the homepage's search box — every photo that has a
// plate on record, with the slug pre-computed so results can link straight
// to /photo/<slug>. A photo with multiple comma-separated plates yields one
// entry per plate, all pointing at the same photo.
export function getPlateIndex(): PlateEntry[] {
  return Object.entries(captions).flatMap(([filename, c]) => {
    if (!c.plate) return [];
    const slug = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return c.plate
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(plate => ({ filename, plate, title: c.title, slug }));
  });
}
