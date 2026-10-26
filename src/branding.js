// Source URLs and asset provenance are recorded in docs/branding.md.
const BRANDS = {
  "8": { color: "#A41F35", alternateColor: "#FFFFFF", location: "Arkansas", mascot: "Razorbacks", logo: "/assets/arkansas.png" },
  "238": { color: "#000000", alternateColor: "#CFAE70", logo: "/assets/vanderbilt.png" },
  "254": { color: "#BE0000", alternateColor: "#FFFFFF" },
  "245": { color: "#500000", alternateColor: "#FFFFFF" },
  "2": { color: "#0C2340", alternateColor: "#F26522" },
  "251": { color: "#BF5700", alternateColor: "#FFFFFF" },
};

function hex(value, fallback) {
  const bare = String(value ?? "").replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(bare) ? `#${bare}` : fallback;
}

export function teamBrand(team, league = "college-football") {
  // ESPN IDs are league-local: NFL 8 is Detroit, not Arkansas.
  const override = league === "college-football" ? BRANDS[String(team.id)] : null;
  const location = team.location ?? team.shortDisplayName ?? team.abbreviation ?? "Team";
  // Prefer the provider's dark-background artwork for the scoreboard/field.
  // Only use URLs returned by the provider; never guess filenames from a name.
  const images = team.logos ?? [];
  const logos = [...new Set([
    override?.logo,
    images.find((image) => image.rel?.includes("dark"))?.href,
    ...images.map((image) => image.href),
    team.logo,
  ].filter((url) => typeof url === "string" && (url.startsWith("/assets/") || url.startsWith("https://"))))];
  const brand = {
    location,
    mascot: team.name ?? team.displayName?.replace(`${location} `, "") ?? "Football",
    color: hex(team.color, "#222222"),
    alternateColor: hex(team.alternateColor, "#FFFFFF"),
    logo: logos[0] ?? null,
    logos,
    ...override,
  };
  return brand;
}
