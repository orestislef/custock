// process level facts for the super admin's "This server" screen: when this process started and
// when the job worker last went round. the worker runs in the same process as the api.

export const runtime = {
  startedAt: Date.now(),
  workerLastRunAt: null as number | null,
};

export function markWorkerRun(at = Date.now()) {
  runtime.workerLastRunAt = at;
}
