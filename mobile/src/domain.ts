export const TERMS_VERSION = '2026-09-27';
export const WEBSITE = 'https://prod-plan.com';
export type Member = { id: string; name: string; email?: string | null; active: number };
export type Plan = { id: string; name: string; startDate: string; endDate: string; archived?: boolean };
export type Availability = { memberId: string; date: string; available: boolean };
export type PlanState = { event: Plan; members: Member[]; managedMembers?: Member[]; availability: Availability[]; viewer: { isAdmin: boolean; memberId: string | null; email: string } };
export type Profile = { email: string; profile: { name: string; sex: string; ageRange: string } | null; termsVersion?: string };
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function localDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Use dates in YYYY-MM-DD format.');
  const [y,m,d] = value.split('-').map(Number);
  const result = new Date(y,m-1,d);
  if (dateKey(result)!==value) throw Error('Enter a real calendar date.');
  return result;
}
export function validatePlan(name: string, startDate: string, endDate: string, members: string[]) {
  const start=localDate(startDate), end=localDate(endDate);
  const days = (Date.UTC(end.getFullYear(),end.getMonth(),end.getDate())-Date.UTC(start.getFullYear(),start.getMonth(),start.getDate()))/86400000;
  if (!name.trim() || name.trim().length>120) throw Error('Give your event a name of up to 120 characters.');
  if (days<0 || days>365 || startDate<'2000-01-01' || endDate>'2100-12-31') throw Error('Choose a date range of up to one year.');
  if (members.length<2 || members.length>50 || members.some(n=>!n || n.length>80)) throw Error('Add between 2 and 50 names, each up to 80 characters.');
  if (new Set(members.map(n=>n.trim().toLowerCase())).size!==members.length) throw Error('Give each person a distinct name.');
}
export function monthCells(month: Date): (string | null)[] {
  const offset=(new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7;
  return [...Array(offset).fill(null), ...Array.from({length:new Date(month.getFullYear(),month.getMonth()+1,0).getDate()},(_,i)=>dateKey(new Date(month.getFullYear(),month.getMonth(),i+1)))];
}
export function rankedDates(state: PlanState) {
  const eligible=new Set(state.members.map(m=>m.id));
  const rows=new Map<string, Set<string>>();
  for (const a of state.availability) {
    if (!a.available || !eligible.has(a.memberId) || a.date<state.event.startDate || a.date>state.event.endDate) continue;
    const set=rows.get(a.date) ?? new Set<string>(); set.add(a.memberId); rows.set(a.date,set);
  }
  return [...rows].filter(([,ids])=>ids.size>state.members.length/2).map(([date,ids])=>({date,count:ids.size,names:state.members.filter(m=>ids.has(m.id)).map(m=>m.name)})).sort((a,b)=>b.count-a.count || a.date.localeCompare(b.date));
}
export function invitation(state: PlanState) {
  return `You’re invited to ${state.event.name} on prod. Let us know when you’re free: ${WEBSITE}/?plan=${encodeURIComponent(state.event.id)}\nPrivacy information: ${WEBSITE}/terms#privacy`;
}
