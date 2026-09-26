import cron from "node-cron";
import { runRetentionJob } from "@/lib/retention/run";
import { runFollowUpJob } from "./run";

// Default: every 6 hours (00:00, 06:00, 12:00, 18:00 server time). Override with SERVICE_CALL_CRON.
const DEFAULT_SCHEDULE = "0 */6 * * *";

// Survives dev-server reloads so the job is not scheduled twice.
const globalForCron = globalThis as unknown as { followUpCronStarted?: boolean };

/** Follow-ups, then retention; one after the other so they don't compete for the database. */
async function runScheduledJobs() {
  await runFollowUpJob();
  await runRetentionJob();
}

export function scheduleFollowUpCron() {
  if (globalForCron.followUpCronStarted) return;

  const schedule = process.env.SERVICE_CALL_CRON ?? DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[follow-ups] invalid SERVICE_CALL_CRON "${schedule}"; cron job not scheduled`);
    return;
  }

  cron.schedule(schedule, runScheduledJobs, { name: "follow-ups", noOverlap: true });
  globalForCron.followUpCronStarted = true;
  console.log(`[follow-ups] cron scheduled "${schedule}" (follow-ups, then retention)`);

  if (process.env.SERVICE_CALL_RUN_ON_START === "true") void runScheduledJobs();
}
