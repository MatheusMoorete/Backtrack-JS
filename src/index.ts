export * from './types';
export * from './validation/validate';
export * from './core/state-machine';
export * from './core/flight-recorder';
export * from './storage';
export * from './capturers';
export * from './widget/widget';
export * from './capturers/route-matcher';

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
