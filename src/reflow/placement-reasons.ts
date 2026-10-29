import type { DateTime } from 'luxon';
import { toIso } from '../utils/date-utils.js';
import type { IChangeReason } from './types.js';

export type PlacementReason =
  | { event: 'dependency' | 'resource'; relatedId: string; at: DateTime }
  | { event: 'leadingShift' | 'leadingMaintenance'; from: DateTime; to: DateTime }
  | { event: 'pausedShift' | 'pausedMaintenance'; minutes: number };

/** Presentation and deduplication stay outside placement decisions. */
export function formatPlacementReasons(events: PlacementReason[]): IChangeReason[] {
  const seen = new Set<string>();
  const reasons: IChangeReason[] = [];
  for (const event of events) {
    const key = JSON.stringify(event);
    if (seen.has(key)) continue;
    seen.add(key);
    switch (event.event) {
      case 'dependency':
        reasons.push({
          kind: 'dependency',
          relatedId: event.relatedId,
          message: `scheduled after dependency ${event.relatedId} (completes ${toIso(event.at)})`,
        });
        break;
      case 'resource':
        reasons.push({
          kind: 'workCenterConflict',
          relatedId: event.relatedId,
          message: `work center busy with ${event.relatedId} until ${toIso(event.at)}`,
        });
        break;
      case 'leadingShift':
      case 'leadingMaintenance':
        reasons.push({
          kind: event.event === 'leadingShift' ? 'shiftBoundary' : 'maintenanceWindow',
          message: `start moved from ${toIso(event.from)} to ${toIso(event.to)} (${event.event === 'leadingShift' ? 'outside shift hours' : 'maintenance window'})`,
        });
        break;
      case 'pausedShift':
      case 'pausedMaintenance':
        reasons.push({
          kind: event.event === 'pausedShift' ? 'shiftBoundary' : 'maintenanceWindow',
          message: `paused ${event.minutes} min ${event.event === 'pausedShift' ? 'outside shift hours' : 'for maintenance window(s)'}`,
        });
        break;
    }
  }
  return reasons;
}
