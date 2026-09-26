// The retention pass of the scheduled job: notice lapses, ask the customers, tell the owner.
import "server-only";
import { detectLapses } from "./detect";
import { notifyOwners } from "./owner";
import { reachOut } from "./outreach";

export async function runRetentionJob() {
  const started = Date.now();
  try {
    const lapses = await detectLapses();
    const asked = await reachOut(lapses);
    // Also picks up skips recorded in the chat since the last run.
    const told = await notifyOwners();
    console.log(
      `[retention] ${lapses.length} new lapses, ${asked} customers asked, owner told about ${told} in ${Date.now() - started}ms`,
    );
  } catch (error) {
    console.error("[retention] job failed:", error);
  }
}
