"""Builds examples/demo_crew.csv: a realistic 7-day lunar-habitat dataset for 4 astronauts.

Every column SELENE understands is filled in (vitals, sleep, exercise, hydration, radiation,
brainwaves, blood pressure, balance, mood, cabin air and the lunar exterior), so every part of
the dashboard and every voice command has data to show. Deterministic (fixed seed).

    python scripts/make_demo_data.py
"""
import csv, datetime as dt, math, random
from pathlib import Path

CREW = {  # id: (resting HR, HRV, sleep habit, mood baseline, personality of the day)
    "Commander": (60, 62, 7.4, 7.5, "steady"),
    "Pilot": (66, 48, 6.6, 6.8, "busy"),
    "Engineer": (72, 36, 5.6, 5.4, "tired"),
    "Scientist": (63, 55, 7.0, 6.4, "lonely"),
}
COLS = ["timestamp", "astronaut_id", "mission_day", "heart_rate", "hrv_ms", "spo2", "skin_temp_c", "resp_rate",
        "sleep_h", "exercise_min", "resistive_min", "water_ml", "steps", "radiation_msv", "radiation_today_msv",
        "mood", "stress", "eeg_delta", "eeg_theta", "eeg_alpha", "eeg_beta", "eeg_gamma",
        "systolic_bp", "diastolic_bp", "perfusion_index", "balance_score",
        "o2_pct", "ppco2_mmhg", "pressure_kpa", "cabin_temp_c", "humidity_pct",
        "ext_temp_c", "ext_radiation_usv_h", "solar_activity", "dust_level", "sun_elevation_deg"]


def main(days=7, out=Path(__file__).resolve().parent.parent / "examples" / "demo_crew.csv"):
    rnd = random.Random(42)
    end = dt.datetime.now().replace(minute=0, second=0, microsecond=0)
    start = end - dt.timedelta(days=days - 1, hours=end.hour - 7)
    rows, dose = [], {k: 14.0 + i * 0.4 for i, k in enumerate(CREW)}
    t = start
    while t <= end:
        day = (t - start).days + 1
        if 7 <= t.hour <= 22:
            frac = (t.hour - 7) / 15
            sun = 8 + 6 * math.sin(day / 29.5 * 2 * math.pi)
            ext_temp = -20 + 110 * math.sin(math.radians(max(sun, 0)) * 3) if sun > 0 else -150
            solar = 2 + (5 if day == days - 2 and 12 <= t.hour <= 16 else 0) + rnd.random()
            for aid, (hr0, hrv0, sleep0, mood0, kind) in CREW.items():
                tired = kind == "tired"
                active = 1 if 9 <= t.hour <= 11 or 16 <= t.hour <= 18 else 0
                hr = hr0 + 18 * active + rnd.gauss(0, 3) + (6 if tired else 0)
                today_dose = 0.28 + (0.35 if solar > 6 else 0) + rnd.random() * 0.04
                dose[aid] += today_dose / 16
                mood = mood0 + rnd.gauss(0, 0.6) - (1.2 if kind == "lonely" and t.hour > 18 else 0)
                stress = max(1, 9 - mood + rnd.gauss(0, 0.8) + (1.5 if kind == "busy" else 0))
                # brainwave shares: focused mornings, relaxed evenings, drowsy when tired
                alpha = 0.22 + 0.12 * frac + (0.04 if kind == "steady" else 0)
                beta = 0.30 - 0.1 * frac + (0.08 if kind == "busy" else 0)
                theta = 0.14 + (0.12 if tired else 0) + 0.05 * frac
                delta = 0.12 + (0.08 if tired else 0)
                gamma = 0.06 + (0.03 if kind == "busy" else 0)
                tot = alpha + beta + theta + delta + gamma
                rows.append({
                    "timestamp": t.isoformat(), "astronaut_id": aid, "mission_day": 40 + day,
                    "heart_rate": round(hr), "hrv_ms": round(hrv0 - 10 * active + rnd.gauss(0, 4) - (8 if tired else 0)),
                    "spo2": round(97.6 + rnd.gauss(0, 0.4), 1), "skin_temp_c": round(36.6 + 0.3 * active + rnd.gauss(0, 0.1), 1),
                    "resp_rate": round(13 + 5 * active + rnd.gauss(0, 1)),
                    "sleep_h": round(sleep0 + rnd.gauss(0, 0.4), 1),
                    "exercise_min": round(min(150, frac * (120 if not tired else 70) + rnd.gauss(0, 5))),
                    "resistive_min": round(min(75, frac * (60 if not tired else 30))),
                    "water_ml": round(frac * (2600 if kind != "busy" else 1500) + 250),
                    "steps": max(0, round(frac * 6000 + rnd.gauss(0, 200))),
                    "radiation_msv": round(dose[aid], 2), "radiation_today_msv": round(today_dose * frac, 2),
                    "mood": round(min(10, max(1, mood)), 1), "stress": round(min(10, stress), 1),
                    "eeg_delta": round(delta / tot, 3), "eeg_theta": round(theta / tot, 3), "eeg_alpha": round(alpha / tot, 3),
                    "eeg_beta": round(beta / tot, 3), "eeg_gamma": round(gamma / tot, 3),
                    "systolic_bp": round(118 + 10 * active + rnd.gauss(0, 4) + (6 if kind == "busy" else 0)),
                    "diastolic_bp": round(76 + 5 * active + rnd.gauss(0, 3)),
                    "perfusion_index": round(3.2 + rnd.gauss(0, 0.4), 1),
                    "balance_score": round(86 - (14 if tired else 0) + rnd.gauss(0, 3)),
                    "o2_pct": round(20.9 + rnd.gauss(0, 0.1), 1), "ppco2_mmhg": round(2.2 + 0.6 * active + rnd.gauss(0, 0.2), 1),
                    "pressure_kpa": round(101.3 + rnd.gauss(0, 0.1), 1), "cabin_temp_c": round(22 + rnd.gauss(0, 0.3), 1),
                    "humidity_pct": round(45 + rnd.gauss(0, 2)),
                    "ext_temp_c": round(ext_temp + rnd.gauss(0, 3)), "ext_radiation_usv_h": round(13 + (40 if solar > 6 else 0) + rnd.gauss(0, 2)),
                    "solar_activity": round(min(9, solar), 1), "dust_level": round(min(10, max(0, 2 + rnd.gauss(0, 1) + (3 if day == days - 1 else 0))), 1),
                    "sun_elevation_deg": round(sun, 1),
                })
        t += dt.timedelta(hours=3)
    out.parent.mkdir(exist_ok=True)
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    print(f"Wrote {len(rows)} rows for {len(CREW)} astronauts to {out}")


if __name__ == "__main__":
    main()
