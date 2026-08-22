// Event definitions — each event page pulls its photos from one or more
// asset category folders. Add a new event here and it appears at /events
// and gets its own page at /events/<slug>.

export interface EventDef {
  slug: string;
  name: string;
  /** Short form for tight spaces like /gallery filter chips, e.g. "Le Mans 2026" for "24 Heures du Mans 2026" */
  shortLabel: string;
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
    shortLabel: 'Le Mans 2026',
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
    shortLabel: 'ICCR',
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
  {
    slug: 'bimmerfest-2026',
    name: 'Bimmerfest 2026',
    shortLabel: 'Bimmerfest',
    venue: 'Mondello Park, Naas, Co. Kildare, Ireland',
    season: '2026',
    categories: ['bimmerfest'],
    hero: 'DSC_5722.jpg',
    intro: [
      'An open-pitlane trackday at Mondello Park, run by trackdays.ie under the Bimmerfest banner, with BMW\'s M division taking centre stage — E36, E46, E92 and F80 M3s, the M2 and M4 in half a dozen colours, and a brand new M5 all turning laps and filling the paddock.',
      'The BMW theme didn\'t stop other marques joining in: a Subaru Impreza, a Skoda Fabia rally car, a run of Renault Clio and Mégane RS track cars, a Ford Fiesta and a SEAT Leon Cupra all shared the circuit, alongside lightweight specials and open-cockpit prototypes. A BMW Motorsport tribute livery and Austin O\'Brien\'s Jägermeister-liveried E36, built for the Irish Touring Car Championship, drew plenty of attention in the paddock.',
    ],
    classes: ['BMW M2', 'BMW M3', 'BMW M4', 'BMW M5', 'Hot Hatches', 'Trackday'],
    description: 'Photo coverage of the Bimmerfest 2026 trackday at Mondello Park by Marc Ronan — BMW M cars and a mixed open-pitlane paddock, run by trackdays.ie.',
  },
  {
    slug: 'retrostock-2026',
    name: 'Retrostock 2026',
    shortLabel: 'Retrostock',
    venue: 'Mondello Park, Naas, Co. Kildare, Ireland',
    season: 'August 2026',
    categories: ['retrostock'],
    hero: 'DSC_6729-Enhanced-NR.jpg',
    intro: [
      'A day of old-school motorsport at Mondello Park, built entirely around pre-1994 machinery — rally, road and sprint cars turning laps on the full circuit.',
      'Sessions rotated every 20 minutes between drifting and grip driving, giving a mix of sideways action and tight, committed racing lines throughout the day, all from cars built well before modern electronics and aids.',
    ],
    classes: ['Pre-1994 Rally', 'Pre-1994 Road', 'Pre-1994 Sprint', 'Drifting', 'Grip Driving'],
    description: 'Photo coverage of Retrostock 2026 at Mondello Park by Marc Ronan — pre-1994 rally, road and sprint cars across drifting and grip driving sessions.',
  },
  {
    slug: 'drift-games-summer-bash-2026',
    name: 'Drift Games Summer Bash 2026',
    shortLabel: 'Drift Games',
    venue: 'Mondello Park, Naas, Co. Kildare, Ireland',
    season: 'August 2026',
    categories: ['drift-games'],
    hero: 'DSC_6961-Enhanced-NR.jpg',
    intro: [
      'Two days of drifting at Mondello Park for the Tire Streets Drift Games Summer Bash, with over 150 drivers running across all four of the venue\'s layouts plus Sportsland.',
      'Big grids and bigger tandems throughout, from pro drivers sharpening their craft to grid-fillers just out for the fun of it, the way drifting was meant to be.',
    ],
    classes: ['Drifting', 'Tandem Battles'],
    description: 'Photo coverage of the 2026 Tire Streets Drift Games Summer Bash at Mondello Park by Marc Ronan — over 150 drivers, big tandems, across all four track layouts.',
  },
];

export function getEvent(slug: string): EventDef | undefined {
  return events.find(e => e.slug === slug);
}
