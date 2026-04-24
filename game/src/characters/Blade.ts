import { ClassPassives } from "../tempo/TempoSystem";

/** Blade — only character in the MVP. RH2's "blade" passives, port subset. */
export const BLADE = {
  id: "blade",
  name: "Blade",
  hp: 100,
  passives: {
    /** Crashes at 70 instead of 100 (and resets to lower value). */
    crashResetValue: 50,
  } as ClassPassives,
};
