export * from './types';
export * from './validation/validate';
export * from './core/state-machine';
export * from './core/flight-recorder';
export * from './storage';
export * from './capturers';

// Canonical Backtrack Exports and Aliases
import { FlightRecorderImpl, createFlightRecorder } from './core/flight-recorder';
import type { FlightRecorder, FlightRecorderOptions } from './types/options';

export {
  FlightRecorderImpl as Backtrack,
  FlightRecorderImpl as BacktrackImpl,
  createFlightRecorder as createBacktrack
};

export type {
  FlightRecorder as BacktrackRecorder,
  FlightRecorderOptions as BacktrackOptions
};
