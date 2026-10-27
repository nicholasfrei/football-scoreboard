// An offline, fictional NFL game. Yardage is measured from Dallas's goal
// line: home drives left, away drives right, just like the live field renderer.
const cowboys = {
  id: "6", name: "Dallas Cowboys", shortName: "Dallas", location: "Dallas",
  abbreviation: "DAL", mascot: "Cowboys", color: "#002A5C", alternateColor: "#B0B7BC", logo: "/assets/cowboys.png",
};
const eagles = {
  id: "21", name: "Philadelphia Eagles", shortName: "Philadelphia", location: "Philadelphia",
  abbreviation: "PHI", mascot: "Eagles", color: "#06424D", alternateColor: "#000000", logo: "/assets/eagles.png",
};

const steps = [
  { clock: "12:00", spot: 25, down: "1st & 10", gain: 35, text: "Kickoff returned to the Dallas 25. The Cowboys take the field." },
  { clock: "11:34", spot: 29, down: "2nd & 6", gain: 35, text: "Dallas runs for 4 yards to its own 29." },
  { clock: "11:02", spot: 37, down: "1st & 10", gain: 47, kind: "first-down", text: "8-yard completion. First down! The chains reset 10 yards ahead." },
  { clock: "10:31", spot: 40, down: "2nd & 7", gain: 47, text: "A 3-yard run brings up second and seven." },
  { clock: "10:25", spot: 40, down: "3rd & 7", gain: 47, text: "Incomplete pass. No ball movement; now third and seven." },
  { clock: "9:53", spot: 54, down: "1st & 10", gain: 64, kind: "first-down", text: "14-yard completion across midfield to the Philadelphia 46. First down." },
  { clock: "9:21", spot: 60, down: "2nd & 4", gain: 64, text: "Dallas runs for 6 yards to the Philadelphia 40." },
  { clock: "8:49", spot: 76, down: "1st & 10", gain: 86, kind: "first-down", text: "16-yard completion to the Philadelphia 24. Another first down." },
  { clock: "8:17", spot: 85, down: "2nd & 1", gain: 86, text: "A 9-yard run into the red zone. One yard short of a first down." },
  { clock: "7:45", spot: 90, down: "1st & Goal", gain: 100, kind: "first-down", text: "A 5-yard run earns first and goal at the 10. The goal line is now the target." },
  { clock: "7:12", spot: 100, down: "TOUCHDOWN", home: 6, kind: "touchdown", text: "10-yard touchdown pass! Dallas finishes a 75-yard drive. Six points go on the board." },
  { clock: "7:12", spot: 85, down: "XP attempt", home: 6, text: "Extra-point unit takes the field. The NFL kick try is snapped from the 15." },
  { clock: "7:12", home: 7, kind: "extra-point", text: "Extra point is GOOD. The kick adds one: Dallas leads 7–0." },
  { clock: "7:05", awayBall: true, spot: 75, down: "1st & 10", gain: 65, home: 7, text: "Kickoff returned to the Philadelphia 25. The Eagles take over, moving left on the field." },
  { clock: "6:40", awayBall: true, spot: 57, down: "1st & 10", gain: 47, home: 7, kind: "first-down", text: "Philadelphia completes an 18-yard pass to its own 43. First down." },
  { clock: "6:08", awayBall: true, spot: 50, down: "2nd & 3", gain: 47, home: 7, text: "A 7-yard run reaches midfield." },
  { clock: "5:36", awayBall: true, spot: 34, down: "1st & 10", gain: 24, home: 7, kind: "first-down", text: "16-yard completion to the Dallas 34. Philadelphia moves the chains." },
  { clock: "5:04", awayBall: true, spot: 30, down: "2nd & 6", gain: 24, home: 7, text: "A 4-yard run to the Dallas 30." },
  { clock: "4:58", awayBall: true, spot: 30, down: "3rd & 6", gain: 24, home: 7, text: "Incomplete pass. The ball stays at the 30." },
  { clock: "4:26", awayBall: true, spot: 28, down: "4th & 4", gain: 24, home: 7, text: "A 2-yard completion falls short. Fourth and four; the field-goal unit comes on." },
  { clock: "4:21", awayBall: true, home: 7, away: 3, kind: "field-goal", text: "45-yard field goal is GOOD (28 yards + 10-yard end zone + 7-yard hold). Three points for Philadelphia." },
  { clock: "4:15", spot: 20, down: "1st & 10", gain: 30, home: 7, away: 3, text: "Kickoff returned to the Dallas 20. The Cowboys begin their next drive." },
  { clock: "3:43", spot: 23, down: "2nd & 7", gain: 30, home: 7, away: 3, text: "Dallas runs for 3 yards to its own 23." },
  { clock: "3:37", spot: 23, down: "3rd & 7", gain: 30, home: 7, away: 3, text: "Incomplete pass. Third and seven for the Cowboys." },
  { clock: "3:05", spot: 25, down: "4th & 5", gain: 30, home: 7, away: 3, text: "A 2-yard completion comes up short. Fourth and five; Dallas sends out the punter." },
  { clock: "2:53", awayBall: true, spot: 65, down: "1st & 10", gain: 55, home: 7, away: 3, kind: "punt", eventTeamId: "6", text: "Dallas punts 45 yards to the Philadelphia 30. A 5-yard return sets up the Eagles at their own 35." },
  { clock: "2:21", awayBall: true, spot: 64, down: "2nd & 9", gain: 55, home: 7, away: 3, text: "Philadelphia runs for 1 yard to its own 36." },
  { clock: "2:15", awayBall: true, spot: 64, down: "3rd & 9", gain: 55, home: 7, away: 3, text: "Incomplete pass. Third and nine for the Eagles." },
  { clock: "1:43", awayBall: true, spot: 62, down: "4th & 7", gain: 55, home: 7, away: 3, text: "A 2-yard run brings up fourth and seven at the Philadelphia 38. Punt unit coming on." },
  { clock: "1:35", spot: 72, down: "1st & 10", gain: 82, home: 7, away: 3, kind: "blocked-punt", text: "PUNT BLOCKED by Dallas! The Cowboys recover at the Philadelphia 28 and take over with a short field." },
  { clock: "1:35", home: 7, away: 3, text: "Demo complete: Cowboys 7, Eagles 3. Touchdown, XP, field goal, punt, and blocked punt. Replay to watch again." },
];

export function createDemoFrames() {
  const plays = [];
  const highlights = [];
  const details = {
    "first-down": "MOVE THE CHAINS", "extra-point": "IT’S GOOD · +1",
    "field-goal": "IT’S GOOD · +3", punt: "PUNTING TEAM", "blocked-punt": "BLOCKED BY",
  };
  return steps.map((step, index) => {
    const offense = step.awayBall ? eagles : cowboys;
    const event = step.kind ? {
      id: `demo-${index}`, sequence: index, kind: step.kind, teamId: step.eventTeamId ?? offense.id,
      detail: details[step.kind],
    } : null;
    if (event) highlights.push(event);
    plays.unshift({ id: `demo-${index}`, period: 1, clock: step.clock, text: step.text,
      scoring: ["touchdown", "extra-point", "field-goal"].includes(step.kind) });
    return {
      team: cowboys, league: "nfl", season: "DEMO", timeZone: "America/Chicago",
      nextGame: null, stale: false, caption: step.text,
      spotlight: {
        id: "demo-drive", league: "nfl", state: "live", status: "Demo", homeAway: "home",
        period: 1, clock: step.clock, venue: "AT&T Stadium · simulated matchup", broadcasts: ["DEMO"],
        selectedTeam: { ...cowboys, score: step.home ?? 0 }, opponent: { ...eagles, score: step.away ?? 0 },
        possessionTeamId: step.spot == null ? null : offense.id,
        ball: step.spot == null ? null : {
          percent: 100 - step.spot, possession: offense.shortName, direction: step.awayBall ? "right" : "left",
          label: step.spot === 50 ? "50-yard line" : step.spot < 50 ? `DAL ${step.spot}` : `PHI ${100 - step.spot}`,
          downDistance: step.down, firstDownPercent: step.gain == null ? null : 100 - step.gain, source: "simulated position",
        },
        highlights: [...highlights], latestPlaySequence: index, plays: plays.slice(0, 5),
      },
    };
  });
}
