import test from 'node:test';import assert from 'node:assert/strict';
import {sessionFromCalendar} from '../server/calendar.mjs';
test('official half-day, holiday absence and DST are distinguished',()=>{
 const day=[{date:'2026-11-27',open:'09:30',close:'13:00'}];
 assert.equal(sessionFromCalendar('2026-11-27T17:59:00Z',day),'regular');
 assert.equal(sessionFromCalendar('2026-11-27T18:00:00Z',day),'extended');
 assert.equal(sessionFromCalendar('2026-11-26T16:00:00Z',day),'unknown');
 assert.equal(sessionFromCalendar('2026-09-04T13:30:00Z',[{date:'2026-09-04',open:'09:30',close:'16:00'}]),'regular');
 assert.equal(sessionFromCalendar('invalid',day),'unknown');
});
