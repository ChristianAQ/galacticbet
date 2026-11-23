/**
 * Football-Data publishes nationalities as English names. For the player's
 * card: the flag and the name in Spanish. Unknown ones keep their name and
 * go without a flag.
 */
const CODES: Record<string, string> = {
  Spain: "ES", France: "FR", Germany: "DE", Italy: "IT", Portugal: "PT", Netherlands: "NL",
  Belgium: "BE", Brazil: "BR", Argentina: "AR", Uruguay: "UY", Colombia: "CO", Croatia: "HR",
  Serbia: "RS", Norway: "NO", Denmark: "DK", Sweden: "SE", Poland: "PL", Morocco: "MA",
  Senegal: "SN", Nigeria: "NG", Ghana: "GH", "Ivory Coast": "CI", "Côte d'Ivoire": "CI",
  "Cote d'Ivoire": "CI", Cameroon: "CM", Algeria: "DZ", Egypt: "EG", Mali: "ML", Guinea: "GN",
  "United States": "US", USA: "US", Mexico: "MX", Canada: "CA", Japan: "JP",
  "Korea Republic": "KR", "South Korea": "KR", Switzerland: "CH", Austria: "AT", Turkey: "TR",
  "Türkiye": "TR", Ukraine: "UA", Georgia: "GE", "Republic of Ireland": "IE", Ireland: "IE",
  "Czech Republic": "CZ", Czechia: "CZ", Slovakia: "SK", Slovenia: "SI", Hungary: "HU",
  Romania: "RO", Greece: "GR", Albania: "AL", Kosovo: "XK", "Bosnia-Herzegovina": "BA",
  "Bosnia and Herzegovina": "BA", Montenegro: "ME", "North Macedonia": "MK", Venezuela: "VE",
  Ecuador: "EC", Paraguay: "PY", Chile: "CL", Peru: "PE", Bolivia: "BO", Australia: "AU",
  Gabon: "GA", "Congo DR": "CD", "DR Congo": "CD", Congo: "CG", "Equatorial Guinea": "GQ",
  "Cape Verde Islands": "CV", "Cape Verde": "CV", Tunisia: "TN", Jamaica: "JM", Iceland: "IS",
  Finland: "FI", Russia: "RU", Israel: "IL", Iran: "IR", "Dominican Republic": "DO",
  Honduras: "HN", "Costa Rica": "CR", Panama: "PA", "Guinea-Bissau": "GW", "Burkina Faso": "BF",
  Angola: "AO", Mozambique: "MZ", Zambia: "ZM", Zimbabwe: "ZW", "South Africa": "ZA",
  Armenia: "AM", Azerbaijan: "AZ", Belarus: "BY", Bulgaria: "BG", Cyprus: "CY", Estonia: "EE",
  Latvia: "LV", Lithuania: "LT", Luxembourg: "LU", Malta: "MT", Moldova: "MD",
  "New Zealand": "NZ", Haiti: "HT", "Curaçao": "CW", Curacao: "CW", Suriname: "SR",
  "Saudi Arabia": "SA", Qatar: "QA", "China PR": "CN", China: "CN", Uzbekistan: "UZ",
  Togo: "TG", Benin: "BJ", Gambia: "GM", "Sierra Leone": "SL", Liberia: "LR", Comoros: "KM",
  Mauritania: "MR", Kenya: "KE", Tanzania: "TZ", Uganda: "UG", Sudan: "SD", Libya: "LY",
};
// The home nations have their own flags (tag sequences) and names.
const HOME: Record<string, { name: string; flag: string }> = {
  England: { name: "Inglaterra", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  Scotland: { name: "Escocia", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  Wales: { name: "Gales", flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿" },
  "Northern Ireland": { name: "Irlanda del Norte", flag: "🇬🇧" },
};

let names: Intl.DisplayNames | null | undefined;
const regionName = (code: string) => {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["es"], { type: "region" });
    } catch {
      names = null;
    }
  }
  if (code === "XK") return "Kosovo";
  try {
    return names?.of(code) || null;
  } catch {
    return null;
  }
};
const flagOf = (code: string) =>
  code === "XK"
    ? "🇽🇰"
    : String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export function nation(value: string | null | undefined): { name: string; flag: string | null } | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (HOME[raw]) return HOME[raw];
  const code = CODES[raw];
  if (!code) return { name: raw, flag: null };
  return { name: regionName(code) || raw, flag: flagOf(code) };
}
