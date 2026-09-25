// Runs once per server start. Schedules background jobs on the Node.js runtime only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { scheduleFollowUpCron } = await import("./lib/server/cron");
  scheduleFollowUpCron();
}
