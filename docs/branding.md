# Team branding sources

[Documentation](README.md) · [Display behavior](display-behavior.md)

The app supports both NFL and NCAA teams. This reference records the bundled
college artwork and verified overrides; other teams use provider metadata.

Verified October 26, 2026. `src/branding.js` overrides provider colors with the
school-published values below **only in the college-football league**. NFL teams
use ESPN's team metadata and original artwork. Numeric IDs overlap between
leagues; an NFL ID must never use a college override. The selected team in
`config.json` controls the header, while the home team controls the field.
Original logo artwork is displayed without
recoloring, stretching, mirroring, or replacing it with an invented monogram.
End-zone names are plain display text, not reproductions of proprietary wordmarks.

## Local artwork

- `public/assets/arkansas.png`: [Arkansas Athletics' dark-background Razorback artwork](https://arkansasrazorbacks.com/wp-content/uploads/2021/09/arkansas-dark-logo.png), linked by the [official athletics site](https://arkansasrazorbacks.com/).
- `public/assets/vanderbilt.png`: [Vanderbilt white-outline athletic V artwork](https://storage.googleapis.com/vucommodores-prod/2024/12/Vanderbilt-White-Outline.png), served by the [official athletics site](https://vucommodores.com/). The [athletics brand guide](https://vucommodores.com/vanderbilt-athletics-brand-guide) identifies the athletic V as the primary mark.

Artwork remains the property of its respective owner; these source links establish
provenance, not a license or an official endorsement of this project.

The [Cowboys screenshot](images/cowboys-scoreboard.png) uses Dallas and Green Bay
artwork returned by ESPN. NFL logos are not replaced with college overrides.

## Color overrides for Arkansas and its 2026 road hosts

| Team | Primary field color | Supporting color | First-party source |
| --- | --- | --- | --- |
| Arkansas | Cardinal `#A41F35` | White `#FFFFFF` | [Athletics licensing / color palette](https://arkansasrazorbacks.com/licensing/) |
| Vanderbilt | Rich black `#000000` | Flat gold `#CFAE70` | [Athletics style guide](https://cdn.vanderbilt.edu/vu-sub/wp-content/uploads/sites/276/2025/03/25155751/Vanderbilt-Athletics-Style-Guide_2025.pdf) |
| Utah | Utah red `#BE0000` | White `#FFFFFF` | [University digital color specifications](https://brand.utah.edu/branding/colors/) |
| Texas A&M | Aggie maroon `#500000` | White `#FFFFFF` | [Official brand colors](https://marcomm.tamu.edu/creative-platform/visual-style/brand-colors/) |
| Auburn | Athletics blue `#0C2340` | Athletics orange `#F26522` | [Athletics traditions / colors](https://auburntigers.com/traditions-about-auburn) |
| Texas | Burnt orange `#BF5700` | White `#FFFFFF` | [Official brand colors](https://umac.utexas.edu/brand-center/colors/) |

Every team in the displayed and next matchup is resolved by ESPN team ID using
`/apis/site/v2/sports/football/{league}/teams/{id}`, where `{league}` is `nfl`
or `college-football`. College lookups include FBS and FCS opponents; there is
no conference, opponent-name, or season allowlist.
The canonical `displayName`, `location`, and `name` supply the scoreboard name,
location-name end zone, and mascot end zone respectively. This avoids guessing a
mascot from shortened schedule labels. Metadata is cached for 24 hours; failures
retain available event data or cached metadata and retry after one minute.

Other opponents' logos and colors come from that metadata rather than a separate
school-by-school verification. Dark-background logos are preferred; alternate
provider-returned artwork is tried if an image fails. Missing colors fall back
to neutral charcoal/white; if all logos fail, the abbreviation is displayed.
Provider completeness still determines which artwork is available.
The overrides above refine verified colors/artwork; they are not required to add
new opponents. Add school-verified corrections here and in `src/branding.js` when
needed, without adding opponent-specific fetching logic.

## Field behavior

Both end zones use the **designated home team's primary color**, with its location
name in one and mascot in the other. The same team's logo occupies midfield.
For neutral-site games the heading explicitly says “designated home.” The
field is a schematic, not a replica of the stadium's painted surface.
The fixed orientation is home offense → and away offense ←; it does not simulate
real-world quarter-by-quarter changes of end.
The field footer displays one HOME/AWAY label relative to the selected team (NEUTRAL SITE
for neutral games), and FINAL for completed games.
