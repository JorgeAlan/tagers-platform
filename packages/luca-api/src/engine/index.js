/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA ENGINE - Exports
 * ═══════════════════════════════════════════════════════════════════════════
 */

export { BaseDetector } from "./BaseDetector.js";
export { runDetector, runDetectors, getAvailableDetectors } from "./detectorRunner.js";
export { 
  initScheduler, 
  scheduleDetectors, 
  triggerDetector, 
  getQueueStatus, 
  closeScheduler 
} from "./scheduledRunner.js";

// Detectores
export { SalesAnomalyDetector } from "./detectors/salesAnomalyDetector.js";
