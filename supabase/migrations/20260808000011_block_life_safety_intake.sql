-- Refuse life-safety reports at the database.
--
-- `intake_blocked` existed on silver.fault_type from the start and
-- gold.submit_report has always checked it, but no row ever set it. The result:
-- posting "Elderly neighbour trapped upstairs, cannot get out" to the public API
-- returned a reference and "It is in the queue to be looked at."
--
-- That is the single worst thing this prototype could do. A form that quietly
-- absorbs a life-safety report is worse than no form, because the person who
-- filed it now believes someone is coming. CALL_111 in prototype/lib/taxonomy.ts
-- hides these categories in the UI; this closes the same door at the API, which
-- is the one other teams and the shared operating picture can reach.
--
-- Enforced at intake only. Existing rows in these categories are left alone: a
-- report already taken by phone or radio is a record WCC needs, and deleting it
-- would lose information rather than protect anyone.

set search_path = public, extensions;

update silver.fault_type
   set intake_blocked = true,
       intake_block_reason =
         'This needs a phone call, not a form. If someone is trapped, hurt or in '
         || 'danger, call 111 now. This prototype cannot dispatch help.'
 where code = 'assistance';

update silver.fault_type
   set intake_blocked = true,
       intake_block_reason =
         'A damaged or unsafe building needs to be assessed, not queued. If anyone '
         || 'is trapped or hurt, call 111. Otherwise call the Council contact '
         || 'centre on 04 499 4444.'
 where code = 'building-damage';

-- The contact-centre categories in taxonomy.ts (biohazard, water-out,
-- power-out) are deliberately NOT blocked. They are urgent but not life-safety,
-- the app already steers people to 04 499 4444, and a report of a burst main
-- that reaches WCC late is still worth having. Blocking them would throw away
-- exactly the local awareness this channel exists to collect.
