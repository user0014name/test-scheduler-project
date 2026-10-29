import type { IInterval } from '../utils/date-utils.js';
import type { DateTime } from 'luxon';

export interface IReservation {
  interval: IInterval;
  workOrderId: string;
}

/** Sorted, disjoint reservations allow binary conflict lookup without an interval tree. */
export class Reservations {
  private readonly items: IReservation[] = [];
  private readonly blocks: IReservation[] = [];

  constructor(
    private readonly canBridge: (end: DateTime, start: DateTime) => boolean = (end, start) =>
      end >= start,
  ) {}

  get size(): number {
    return this.items.length;
  }

  firstConflict(span: IInterval): IReservation | undefined {
    return this.findConflict(this.items, span);
  }

  /** Query a productive segment; a busy run may also contain proven non-working gaps. */
  blockingRun(span: IInterval): IReservation | undefined {
    return this.findConflict(this.blocks, span);
  }

  private findConflict(items: IReservation[], span: IInterval): IReservation | undefined {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (items[mid].interval.end <= span.start) lo = mid + 1;
      else hi = mid;
    }
    const candidate = items[lo];
    return candidate && candidate.interval.start < span.end ? candidate : undefined;
  }

  add(reservation: IReservation): void {
    // Only accepted, non-overlapping spans enter this index. Array insertion remains O(n).
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.items[mid].interval.start < reservation.interval.start) lo = mid + 1;
      else hi = mid;
    }
    this.items.splice(lo, 0, reservation);
    let blockIndex = 0;
    let high = this.blocks.length;
    while (blockIndex < high) {
      const mid = (blockIndex + high) >>> 1;
      if (this.blocks[mid].interval.end < reservation.interval.start) blockIndex = mid + 1;
      else high = mid;
    }
    // A shared non-working gap cannot hold any production, so it may join a busy run.
    // Individual reservations remain separate for exact fixed-maintenance overlap checks.
    if (
      blockIndex > 0 &&
      this.canBridge(this.blocks[blockIndex - 1].interval.end, reservation.interval.start)
    )
      blockIndex--;
    let start = reservation.interval.start;
    let end = reservation.interval.end;
    let workOrderId = reservation.workOrderId;
    let count = 0;
    while (
      blockIndex + count < this.blocks.length &&
      this.canBridge(end, this.blocks[blockIndex + count].interval.start)
    ) {
      const block = this.blocks[blockIndex + count++];
      if (block.interval.start < start) start = block.interval.start;
      if (block.interval.end > end) {
        end = block.interval.end;
        workOrderId = block.workOrderId;
      }
    }
    this.blocks.splice(blockIndex, count, { interval: { start, end }, workOrderId });
  }
}
