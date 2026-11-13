export const MAX_PLAYERS_PER_ROOM = 16;

export function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

export function isValidRoomCode(code) {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(normalizeRoomCode(code));
}
