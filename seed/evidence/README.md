# Synthetic evidence files

Owner: A. All files are drawings made by `seed/tools/generate-evidence.ts`. Each one says
`SYNTHETIC SAMPLE - NOT A REAL DOCUMENT`. The IMEIs, plate and name are invented. No real person, device or document.

| File | Kind | Shows | Scenarios |
|---|---|---|---|
| `phone-damaged-imei1.png` | DEVICE_PHOTO | Cracked phone, About phone panel with the IMEI of `ITEM-PHONE-1` | A, F |
| `phone-damaged-imei2.png` | DEVICE_PHOTO | Same, with the IMEI of `ITEM-PHONE-2`. The `CLM-1042` photo | D |
| `police-report-phone1.png` | POLICE_REPORT | Name and IMEI of `ITEM-PHONE-1`, dates 2026-11-15 | B, B2 |
| `police-report-phone2.png` | POLICE_REPORT | Name and IMEI of `ITEM-PHONE-2`, already claimed on `CLM-1042` | H |
| `police-report-imei-mismatch.png` | POLICE_REPORT | Right name, IMEI on no policy item | G |
| `non-phone-mug.png` | DEVICE_PHOTO | A coffee mug | evidence mismatch |
| `car-plate.png` | PLATE_PHOTO | Car with plate `DEMO123` | C2 |

Live demo: file claims with a loss date of `2026-11-15` or the current date. Both are inside policy v2.
Policy v2 covers phone damage and theft and drops phone `LOSS`, so a live `LOSS` claim routes with a
"not covered" reason (scenario E2, on purpose).

Regenerate: `npx tsx seed/tools/generate-evidence.ts`.
