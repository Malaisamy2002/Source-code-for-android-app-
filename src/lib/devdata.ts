import { db, nowIso, resyncCounters } from "./localdb";

/**
 * Dev/maintenance helper: wipes transactional data from the local database.
 * (The old 1,00,000-record load-test generator has been removed — it wrote
 * synthetic rows straight into live data.)
 */
export async function clearTestData() {
  await db.turf_bookings.clear();
  await db.snack_sales.clear();
  await db.expenses.clear();
  await db.counters.clear();
  await db.counters.put({ key: "invoice", value: 0, updated_at: nowIso() });
  await resyncCounters();
}
