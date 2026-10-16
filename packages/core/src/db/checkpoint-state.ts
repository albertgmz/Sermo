/** Slots of the Int32Array that startCheckpointer shares with its worker thread. */
/** The number of active `holdCheckpoints` holds. */
export const HOLDS = 0;
/** The number of jobs waiting in `paceWal` for a complete checkpoint. */
export const PACE_WAITING = 1;
/** Counts complete checkpoints (every frame copied); `paceWal` waits for it to move. */
export const CAUGHT_UP = 2;
export const STATE_SLOTS = 3;
