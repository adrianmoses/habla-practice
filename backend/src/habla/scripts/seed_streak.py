"""Seed fake completed sessions for streak + weekly-grid manual verification.

Not a production path — run from a dev shell to recreate the `12 días seguidos`
state shown in `docs/artifacts/habla-screenshot.png` so the UI can be eyeballed
without running N real voice sessions.

Usage (inside the backend dev container):

    uv run python -m habla.scripts.seed_streak --days 12 --sessions-per-day 1

Inserts one session per day ending today, today-1, ..., today-(N-1), in Madrid
local time. Each row has a non-empty placeholder transcript so it counts toward
the streak. Scenario defaults to the first seeded scenario.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime, timedelta

from habla.config import settings
from habla.db.connection import close_db, open_db
from habla.db.schema import SessionStatus
from habla.routes.streak import MADRID_TZ

FAKE_TRANSCRIPT = (
    '[{"role":"agent","text":"¿Qué va a ser?","started_at":"2026-01-01T12:00:00+00:00",'
    '"ended_at":"2026-01-01T12:00:01+00:00"},'
    '{"role":"user","text":"ponme un cortado","started_at":"2026-01-01T12:00:02+00:00",'
    '"ended_at":"2026-01-01T12:00:03+00:00"}]'
)


async def _run(days: int, sessions_per_day: int, scenario_id: int | None) -> None:
    conn = await open_db(settings.db_path)
    try:
        if scenario_id is None:
            cur = await conn.execute("SELECT id FROM scenarios ORDER BY id LIMIT 1")
            row = await cur.fetchone()
            if row is None:
                raise SystemExit("no scenarios seeded — run the app once to populate seeds")
            scenario_id = int(row["id"])

        today_madrid = datetime.now(MADRID_TZ).date()
        inserted = 0
        for day_offset in range(days):
            day = today_madrid - timedelta(days=day_offset)
            for session_idx in range(sessions_per_day):
                # stagger hour so multiple-per-day rows sort distinctly
                hour = 20 - session_idx
                ended_madrid = datetime(day.year, day.month, day.day, hour, tzinfo=MADRID_TZ)
                started_madrid = ended_madrid - timedelta(minutes=5)
                await conn.execute(
                    "INSERT INTO sessions (scenario_id, started_at, ended_at, duration_sec, "
                    "transcript, analysis_status, self_assessment) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        scenario_id,
                        started_madrid.astimezone(UTC).isoformat(),
                        ended_madrid.astimezone(UTC).isoformat(),
                        300,
                        FAKE_TRANSCRIPT,
                        SessionStatus.PENDING,
                        2,
                    ),
                )
                inserted += 1
        await conn.commit()
        print(f"seeded {inserted} session(s) across {days} day(s) for scenario {scenario_id}")
    finally:
        await close_db(conn)


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed fake sessions for streak verification")
    ap.add_argument("--days", type=int, default=12, help="number of consecutive days ending today")
    ap.add_argument("--sessions-per-day", type=int, default=1)
    ap.add_argument("--scenario-id", type=int, default=None, help="default: first seeded scenario")
    args = ap.parse_args()
    asyncio.run(_run(args.days, args.sessions_per_day, args.scenario_id))


if __name__ == "__main__":
    main()
