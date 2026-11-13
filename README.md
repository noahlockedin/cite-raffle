# LockedIn CITE raffle form

Public entry form for the LockedIn booth raffle at CITE. Entries are stored in a Render Key Value (Redis) store. View them at `/entries?key=YOUR_ADMIN_KEY`.

Set these environment variables on the Render web service:

- `REDIS_URL` (from the cite-raffle-kv store)
- `ADMIN_KEY` (secret for the entries page)
- `PORT` (Render sets this automatically)

This repo has no secrets. Do not commit `ADMIN_KEY`.
