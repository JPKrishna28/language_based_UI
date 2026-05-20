"""Translate option_label column in prs_options_rows.csv from English to Hindi.

Usage:
    pip install deep-translator
    python translate_options_hindi.py
"""
import csv
import sys
import time
from pathlib import Path

from deep_translator import GoogleTranslator

SRC = Path(__file__).parent / "prs_options_rows.csv"
DST = Path(__file__).parent / "prs_options_rows_hindi.csv"

BATCH_SIZE = 50
RETRY = 3
SLEEP_BETWEEN_BATCH = 0.5


def translate_batch(translator: GoogleTranslator, texts: list[str]) -> list[str]:
    for attempt in range(RETRY):
        try:
            return translator.translate_batch(texts)
        except Exception as exc:
            if attempt == RETRY - 1:
                raise
            print(f"  batch retry {attempt + 1}/{RETRY}: {exc}", file=sys.stderr)
            time.sleep(2 ** attempt)
    return texts


def main() -> None:
    if not SRC.exists():
        sys.exit(f"missing source: {SRC}")

    with SRC.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        if "option_label" not in fieldnames:
            sys.exit("column 'option_label' not found")
        rows = list(reader)

    unique_labels = sorted({(r["option_label"] or "").strip() for r in rows if (r["option_label"] or "").strip()})
    print(f"rows={len(rows)} unique_labels={len(unique_labels)}")

    translator = GoogleTranslator(source="en", target="hi")
    cache: dict[str, str] = {}

    for i in range(0, len(unique_labels), BATCH_SIZE):
        chunk = unique_labels[i:i + BATCH_SIZE]
        print(f"translating {i + 1}-{i + len(chunk)} / {len(unique_labels)}")
        translated = translate_batch(translator, chunk)
        for src, tgt in zip(chunk, translated):
            cache[src] = tgt if tgt else src
        time.sleep(SLEEP_BETWEEN_BATCH)

    for r in rows:
        label = (r["option_label"] or "").strip()
        if label and label in cache:
            r["option_label"] = cache[label]

    with DST.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"wrote {DST}")


if __name__ == "__main__":
    main()
