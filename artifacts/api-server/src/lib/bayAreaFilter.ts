// Visibility only: preserve imports, job content, and application history.
// Use listing fields, never company headquarters or search-query text.
const BAY_AREA = /\b(?:san francisco|sf bay area|s\.f\. bay area|san francisco bay area|bay area|san jose|oakland|berkeley|emeryville|alameda|albany|el cerrito|richmond|san pablo|pinole|hercules|fremont|newark|union city|hayward|san leandro|san lorenzo|castro valley|pleasanton|dublin|livermore|sunnyvale|santa clara|mountain view|palo alto|menlo park|redwood city|redwood shores|san mateo|foster city|belmont|san carlos|burlingame|millbrae|san bruno|south san francisco|daly city|brisbane|pacifica|half moon bay|east palo alto|cupertino|campbell|los gatos|saratoga|milpitas|morgan hill|gilroy|los altos(?: hills)?|portola valley|woodside|atherton|san rafael|novato|mill valley|sausalito|tiburon|larkspur|corte madera|san anselmo|fairfax|walnut creek|concord|pleasant hill|lafayette|orinda|moraga|san ramon|danville|martinez|pittsburg|antioch|brentwood|oakley|vallejo|benicia|fairfield|suisun city|vacaville|dixon|rio vista|napa|yountville|st\.? helena|calistoga|american canyon|santa rosa|petaluma|rohnert park|cotati|sebastopol|sonoma|windsor|healdsburg|cloverdale|san francisco county|san mateo county|santa clara county|alameda county|contra costa county|marin county|solano county|napa county|sonoma county)\b/i;
const OTHER_STATE = /,\s*(?:AL|AK|AZ|AR|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i;
const OTHER_REGION = /\b(?:alabama|alaska|arizona|arkansas|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|ireland|united kingdom|canada|australia)\b/i;
const OTHER_CITY = /\b(?:los angeles|san diego|sacramento|fresno|bakersfield|irvine|anaheim|long beach|riverside|san bernardino|santa barbara|santa cruz|monterey|stockton|modesto|tracy|seattle|portland|austin|boston|chicago|denver|miami|atlanta|philadelphia|phoenix|las vegas|london|toronto|vancouver)\b/i;
const ADDITIONAL_BAY_CITIES = /\b(?:colma|clayton|monte sereno|belvedere|ross|fairfield|suisun|san geronimo|point reyes|kensington|el sobrante|discovery bay)\b/i;

export function bayAreaFilterReason(
  posting: { location?: string | null; remoteType?: string | null; title?: string | null },
  settings?: { bayAreaNonRemoteOnly?: boolean } | null,
): string | null {
  // Retain the existing persisted key so current saved preferences still work.
  // The setting now means Bay Area OR fully remote, with uncertainty allowed.
  if (settings?.bayAreaNonRemoteOnly === false) return null;
  const indicatesRemote = (value: string) =>
    /\bremote\b|\bwork\s+from\s+home\b|\bwfh\b/i.test(
      value.replace(/\b(?:not|no|non[- ]?)\s*remote\b/gi, ""),
    );
  const workArrangement = posting.remoteType ?? "";
  const requiresOffice = /\bhybrid\b|\bon[- ]?site\b|\bin[- ]?person\b|\b(?:not|no|non[- ]?)\s*remote\b/i;
  // Structured hybrid/on-site metadata is not made fully remote by "2 days
  // remote" elsewhere in the listing. Fully remote evidence always qualifies.
  const fullyRemote = /\b(?:fully|100%|100 percent)\s*remote\b|\bremote[- ]only\b/i;
  const fields = [workArrangement, posting.location ?? "", posting.title ?? ""];
  if (fields.some((value) => fullyRemote.test(value))) return null;
  if (!requiresOffice.test(workArrangement) && fields.some(indicatesRemote)) return null;
  const location = posting.location?.trim() ?? "";
  if (!location || /^(?:unknown|not specified|unspecified|n\/a)$/i.test(location)) {
    return null;
  }
  // Check separate office alternatives independently; San Francisco + New York
  // is eligible, but Richmond, VA must not match Richmond in the East Bay.
  const offices = location.split(/\s*(?:;|\||\/|\bor\b)\s*/i);
  if (offices.some((office) =>
    (BAY_AREA.test(office) || ADDITIONAL_BAY_CITIES.test(office) || /^sf(?:,\s*(?:ca|california))?$/i.test(office.trim())) &&
    !OTHER_STATE.test(office) && !OTHER_REGION.test(office),
  )) return null;
  // Neither an unrecognized city nor an unknown work arrangement is proof
  // that a role is ineligible. Hide only a known outside location AND office work.
  const outsideBayArea = OTHER_STATE.test(location) || OTHER_REGION.test(location) || OTHER_CITY.test(location);
  const officeRequired = requiresOffice.test(workArrangement) || requiresOffice.test(location) || requiresOffice.test(posting.title ?? "");
  return outsideBayArea && officeRequired ? "Outside SF Bay Area; on-site or hybrid" : null;
}
