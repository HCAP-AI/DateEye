import test from 'node:test';
import assert from 'node:assert/strict';
import {localDate,dateKey,validatePlan,monthCells,rankedDates,invitation} from '../src/domain.ts';
test('invalid and impossible dates are rejected',()=>{for(const date of ['2026-02-30','2026-13-01','2026-2-01'])assert.throws(()=>localDate(date));assert.equal(dateKey(localDate('2028-02-29')),'2028-02-29');});
test('calendar is Monday-first and retains leap day',()=>{const cells=monthCells(localDate('2028-02-01'));assert.equal(cells[0],null);assert.equal(cells[1],'2028-02-01');assert.equal(cells.at(-1),'2028-02-29');});
test('plan validation prevents reversed dates, excessive ranges and duplicate people',()=>{assert.throws(()=>validatePlan('Trip','2026-10-10','2026-10-01',['Oliver','Poppy']));assert.throws(()=>validatePlan('Trip','2026-01-01','2027-01-02',['Oliver','Poppy']));assert.throws(()=>validatePlan('Trip','2026-10-01','2026-10-10',['Oliver','oliver']));assert.doesNotThrow(()=>validatePlan('Trip','2026-10-01','2026-10-10',['Oliver','Poppy']));});
test('ranking requires a majority, excludes inactive people and duplicate responses',()=>{
const state={event:{id:'123',name:'Trip',startDate:'2026-10-01',endDate:'2026-10-10'},members:[{id:'a',name:'Oliver'},{id:'b',name:'Poppy'},{id:'c',name:'Henry'}],availability:[{memberId:'a',date:'2026-10-02',available:true},{memberId:'a',date:'2026-10-02',available:true},{memberId:'removed',date:'2026-10-02',available:true},{memberId:'a',date:'2026-10-03',available:true},{memberId:'b',date:'2026-10-03',available:true},{memberId:'c',date:'2026-10-03',available:false},{memberId:'a',date:'2026-10-20',available:true},{memberId:'b',date:'2026-10-20',available:true}]};
assert.deepEqual(rankedDates(state),[{date:'2026-10-03',count:2,names:['Oliver','Poppy']}]);assert.match(invitation(state),/https:\/\/prod-plan.com\/\?plan=123/);assert.match(invitation(state),/terms#privacy/);
});
