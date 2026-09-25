import cron from "node-cron";
import { runFollowUpJob } from "./follow-ups";

// Default: every day at 09:00 server time. Override with SERVICE_CALL_CRON.
const DEFAULT_SCHEDULE = "0 9 * * *";

// Survives dev-server reloads so the job is not scheduled twice.
const globalForCron = globalThis as unknown as { followUpCronStarted?: boolean };

export function scheduleFollowUpCron() {
  if (globalForCron.followUpCronStarted) return;

  if (!process.env.NVIDIA_API_KEY) {
    console.warn("[follow-ups] NVIDIA_API_KEY is not set; cron job not scheduled");
    return;
  }

  const schedule = process.env.SERVICE_CALL_CRON ?? DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[follow-ups] invalid SERVICE_CALL_CRON "${schedule}"; cron job not scheduled`);
    return;
  }

  cron.schedule(schedule, runFollowUpJob, { name: "follow-ups", noOverlap: true });
  globalForCron.followUpCronStarted = true;
  console.log(`[follow-ups] cron scheduled "${schedule}"`);

  if (process.env.SERVICE_CALL_RUN_ON_START === "true") void runFollowUpJob();
}
