// Car tags — lets a photo be found by make/model across every gallery, not
// just within one event. There's no separate tagging step: tags are derived
// by matching known keywords against each photo's caption title, so this
// list is the single thing to maintain. Add a keyword here and every photo
// whose title mentions it picks up the tag automatically, past and future.
//
// Built by scanning the existing caption corpus for recurring make/model
// tokens (see git history for the extraction) — not exhaustive. If a car
// you'd expect to be taggable isn't, it's probably just missing from this
// list; add it.

export const TAGS = [
  // Brands
  'Porsche', 'Ferrari', 'Ford', 'Nissan', 'BMW', 'Toyota', 'Aston Martin', 'Mini',
  'Opel', 'McLaren', 'Cadillac', 'Renault', 'Lancia', 'Mercedes-AMG', 'Mercedes',
  'Honda', 'Alpine', 'Alfa Romeo', 'Mazda', 'Lotus', 'Audi', 'Pagani', 'Lamborghini',
  'Lexus', 'Genesis', 'Subaru', 'Suzuki', 'Skoda', 'Dodge', 'Bentley', 'Volkswagen',
  'Peugeot', 'SEAT', 'Datsun',

  // Models — alphanumeric codes
  'GT3', 'E36', 'E46', 'E30', 'AE86', 'M3', 'M4', 'LMP3', '180SX', 'LMP2', 'R32',
  'M2', 'GT4', 'S13', 'GT2', 'M1', 'MX-5', 'RS500', 'F40', '720S', 'GR010', 'M5',
  'F80', 'Z3', 'KE70', 'F82', 'E28',

  // Models — named
  'Escort', 'Sierra', 'Manta', 'Valkyrie', 'Fiesta', 'Skyline', 'Vantage', 'Cosworth',
  'Cayman', 'Corolla', 'Stratos', 'Clio', 'NSX', 'Impreza', 'Levin', 'Carrera',
  'Celica', 'Emira', 'Fabia', 'Silvia', 'Cefiro', 'Starlet',
] as const;

export type Tag = typeof TAGS[number];

/** Tags found in a caption title, matched as whole words (case-insensitive, plural-tolerant). */
export function extractTags(title: string): Tag[] {
  return TAGS.filter(tag => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}s?\\b`, 'i').test(title);
  });
}

export function tagSlug(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function tagFromSlug(slug: string): Tag | undefined {
  return TAGS.find(t => tagSlug(t) === slug);
}
