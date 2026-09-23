export class AccessError extends Error {
  status: number;
  constructor(message: string, status = 403) { super(message); this.status = status; }
}
export function requireAdmin(isAdmin: boolean) {
  if (!isAdmin) throw new AccessError("Only the administrator can change event details or members.");
}
export function requireOwnMember(ownId: string | null, targetId: unknown) {
  if (!ownId || targetId !== ownId) throw new AccessError("You can only change your own availability.");
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value && value >= "2000-01-01" && value <= "2100-12-31";
}
export function validateEvent(name: unknown, start: unknown, end: unknown) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || !validDate(start) || !validDate(end) || start > end)
    throw new AccessError("Enter a name and a valid date range.", 400);
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 365)
    throw new AccessError("Choose a date range of up to one year.", 400);
  return {name: name.trim(), startDate: start, endDate: end};
}
export function validateMember(name: unknown, email: unknown) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new AccessError("Enter a member name (up to 80 characters).",400);
  const normal = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normal && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normal) || normal.length > 254)) throw new AccessError("Enter a valid sign-in email address.",400);
  return {name:name.trim(), email:normal || null};
}
