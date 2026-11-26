/**
 * PDA BLISS FLOW notification worker — EP00 SCAFFOLD.
 *
 * This process intentionally does nothing: it does not connect to a database,
 * does not claim jobs, does not start timers and does not send LINE messages.
 * The real scheduler is implemented in EP04 against ./contracts.ts.
 */
import { pathToFileURL } from 'node:url';

export interface WorkerStatus {
  mode: 'scaffold';
  schedulerEnabled: false;
  message: string;
}

export function describeWorker(): WorkerStatus {
  return {
    mode: 'scaffold',
    schedulerEnabled: false,
    message:
      'FLOW worker scaffold (EP00): scheduler disabled — no jobs are claimed and no messages are sent.',
  };
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  console.log(JSON.stringify(describeWorker()));
}
