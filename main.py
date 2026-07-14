import csv
import os
import sys
import time

from sarvamai import SarvamAI

INPUT_FILE = "prs_options_rows.csv"
OUTPUT_FILE = "prs_options_rows_marathi.csv"
NEW_COLUMN = "marathi_option_text"

API_KEY = os.environ.get("SARVAM_API_KEY", "sk_8b6glthl_eZRz1ZBE0nluaoVJOdk7855O")

client = SarvamAI(api_subscription_key=API_KEY)


def translate_to_marathi(text: str) -> str:
    if not text or not text.strip():
        return ""
    response = client.text.translate(
        input=text,
        source_language_code="en-IN",
        target_language_code="mr-IN",
        speaker_gender="Male",
        mode="formal",
        model="mayura:v1",
        numerals_format="native",
    )
    if hasattr(response, "translated_text"):
        return response.translated_text
    if isinstance(response, dict):
        return response.get("translated_text", "")
    return str(response)


def main():
    with open(INPUT_FILE, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        if NEW_COLUMN not in fieldnames:
            fieldnames.append(NEW_COLUMN)
        rows = list(reader)

    total = len(rows)
    for i, row in enumerate(rows, 1):
        option = row.get("option_label", "") or ""
        try:
            marathi = translate_to_marathi(option)
        except Exception as e:
            print(f"[{i}/{total}] ERROR: {e}", file=sys.stderr)
            marathi = ""
        row[NEW_COLUMN] = marathi
        print(f"[{i}/{total}] {option[:60]} -> {marathi[:60]}")
        time.sleep(0.3)

    with open(OUTPUT_FILE, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done. Wrote {total} rows to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
