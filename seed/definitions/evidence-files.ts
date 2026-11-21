// Owner: A. Manifest of the synthetic files in seed/evidence/. Every file is a drawing, not a photograph.
import type { EvidenceKind } from "@claims-agent/domain";

export interface EvidenceFile {
  name: string;
  kind: EvidenceKind;
  contentType: "image/png";
  shows: string;
  scenarios: string;
}

export const EVIDENCE_FILES: EvidenceFile[] = [
  { name: "phone-damaged-imei1.png", kind: "DEVICE_PHOTO", contentType: "image/png", shows: "Cracked phone, About phone panel with the IMEI of ITEM-PHONE-1", scenarios: "A, F (live demo: happy path)" },
  { name: "phone-damaged-imei2.png", kind: "DEVICE_PHOTO", contentType: "image/png", shows: "Cracked phone, About phone panel with the IMEI of ITEM-PHONE-2. This is the CLM-1042 photo", scenarios: "D (live duplicate photo), CLM-1042" },
  { name: "police-report-phone1.png", kind: "POLICE_REPORT", contentType: "image/png", shows: "Report with name and the IMEI of ITEM-PHONE-1, incident and report date 2026-11-15", scenarios: "B, B2 (live theft)" },
  { name: "police-report-phone2.png", kind: "POLICE_REPORT", contentType: "image/png", shows: "Report with name and the IMEI of ITEM-PHONE-2 (already claimed on CLM-1042)", scenarios: "H (live duplicate IMEI)" },
  { name: "police-report-imei-mismatch.png", kind: "POLICE_REPORT", contentType: "image/png", shows: "Report with the right name and an IMEI that is on no policy item", scenarios: "G (live identity mismatch)" },
  { name: "non-phone-mug.png", kind: "DEVICE_PHOTO", contentType: "image/png", shows: "A coffee mug, not a phone", scenarios: "Evidence mismatch (live)" },
  { name: "car-plate.png", kind: "PLATE_PHOTO", contentType: "image/png", shows: "Car with plate DEMO123", scenarios: "C2 (live windscreen)" },
];
