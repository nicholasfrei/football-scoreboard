import test from "node:test";
import assert from "node:assert/strict";
import { kickPosition } from "../src/kick-position.js";

test("punt with a receiving-team penalty uses the enforced succeeding spot", () => {
  const home = { id: "phi", abbreviation: "PHI" };
  const away = { id: "dal", abbreviation: "DAL" };
  const play = {
    type: { text: "Punt" },
    text: "B.Anger punts 41 yards to DAL 49, downed by DAL-J.Thomas. PENALTY on PHI-E.Mitchell, Offensive Holding, 10 yards, enforced at DAL 49.",
    start: { team: { id: "dal" } }, end: { team: { id: "phi" }, possessionText: "DAL 49" },
  };
  assert.equal(kickPosition(play, "nfl", home, away)?.label, "PHI 41");
});
