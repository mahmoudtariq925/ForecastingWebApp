// ============================================================================
// ISO country codes for the reporting entities.
//
// Treasury reads the group across eleven columns; full country names set the
// column width and pushed the numbers off screen, and "United Kingdom" says
// nothing "GB" does not once the reader knows they are looking at countries.
// The full name stays in the tooltip and everywhere there is room for it.
// ============================================================================

/**
 * Entity/country name → ISO 3166-1 alpha-2. Keyed lowercase, and deliberately
 * only the names this app actually reports on plus their common variants: a
 * complete ISO table would be a data set to maintain for no benefit, and a
 * name that is not here falls back to something readable rather than wrong.
 */
const ISO_BY_NAME: Record<string, string> = {
  netherlands: 'NL',
  'the netherlands': 'NL',
  germany: 'DE',
  deutschland: 'DE',
  france: 'FR',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  spain: 'ES',
  españa: 'ES',
  italy: 'IT',
  italia: 'IT',
  poland: 'PL',
  polska: 'PL',
  belgium: 'BE',
  switzerland: 'CH',
  austria: 'AT',
  portugal: 'PT',
  ireland: 'IE',
  denmark: 'DK',
  sweden: 'SE',
  norway: 'NO',
  finland: 'FI',
  czechia: 'CZ',
  'czech republic': 'CZ',
  hungary: 'HU',
  romania: 'RO',
  greece: 'GR',
  luxembourg: 'LU',
  'united states': 'US',
  usa: 'US',
  canada: 'CA',
};

/**
 * The short code for an entity, for column headers and chips.
 *
 * An entity is not required to be a country — a legal entity can be called
 * anything — so an unknown name falls back to its initials (up to three
 * characters), which is still short, still stable and never claims to be an
 * ISO code it is not.
 */
export function countryCode(name: string): string {
  const known = ISO_BY_NAME[name.trim().toLowerCase()];
  if (known) return known;
  const words = name.trim().split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 3)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }
  return name.trim().slice(0, 3).toUpperCase();
}
