// Event definitions — each event page pulls its photos from one or more
// asset category folders. Add a new event here and it appears at /events
// and gets its own page at /events/<slug>.

export interface EventDef {
  slug: string;
  name: string;
  venue: string;
  season: string;
  /** Asset folders (src/assets/watermarked/<category>) that make up this event */
  categories: string[];
  /** Filename of the hero/cover image (must live in one of the categories) */
  hero: string;
  /** Intro paragraphs shown above the photo set */
  intro: string[];
  /** Series / classes covered, shown as chips */
  classes: string[];
  /** Meta description for SEO */
  description: string;
}

export const events: EventDef[] = [
  {
    slug: 'le-mans-2026',
    name: '24 Heures du Mans 2026',
    venue: 'Circuit de la Sarthe, Le Mans, France',
    season: 'June 2026',
    categories: ['endurance'],
    hero: 'DSC_4749.jpg',
    intro: [
      'A full week at the Circuit de la Sarthe for the 2026 running of the Le Mans 24 Hours, from the support paddock to the small hours of the race itself.',
      'The set runs across the whole entry: the Hypercar field of Ferrari, Toyota, Porsche, Cadillac, Alpine, Peugeot, BMW and Aston Martin’s Valkyrie, the LMP2 midfield, and the LMGT3 battle. Alongside the main event, the support bill brought Ferrari Challenge Europe, the Michelin Le Mans Cup and Road to Le Mans.',
      'From pit lane walkabouts and grid assembly to fence-line panning at dusk and floodlit night running, the coverage follows the race around the clock.',
    ],
    classes: ['Hypercar', 'LMP2', 'LMGT3', 'Ferrari Challenge', 'Michelin Le Mans Cup', 'Road to Le Mans'],
    description: 'Photo coverage of the 2026 Le Mans 24 Hours at Circuit de la Sarthe by Marc Ronan — Hypercar, LMP2, LMGT3 and the full support bill, day and night.',
  },
  {
    slug: 'iccr-mondello-2026',
    name: 'ICCR at Mondello Park',
    venue: 'Mondello Park, Naas, Co. Kildare, Ireland',
    season: '2026 season',
    categories: ['iccr'],
    hero: 'DSC_5595.jpg',
    intro: [
      'A race day with the Irish Championship Circuit Racing series at Mondello Park, Co. Kildare — Ireland’s home of motorsport.',
      'The programme covered Formula Vee, Formula Sheane, the Junior Mini Challenge and both Fiesta championships, with the visiting Sports 2000 grid from the SRCC joining the bill. National-level racing means the set moves between grid, paddock and trackside: helmets resting on sidepods, wraps and liveries up close, and wheel-to-wheel racing through Mondello’s corners.',
    ],
    classes: ['Formula Vee', 'Formula Sheane', 'Junior Mini Challenge', 'Fiesta Zetec', 'Fiesta ST', 'Sports 2000 (SRCC)'],
    description: 'Photo coverage of an Irish Championship Circuit Racing (ICCR) meeting at Mondello Park by Marc Ronan — Formula Vee, Formula Sheane, Junior Mini Challenge, Fiesta championships and Sports 2000.',
  },
];

export function getEvent(slug: string): EventDef | undefined {
  return events.find(e => e.slug === slug);
}
