#!/usr/bin/env python3
"""List or fill the AcroForm fields of a PDF."""

import argparse
import json

from pypdf import PdfReader, PdfWriter


def list_fields(path: str) -> dict:
    reader = PdfReader(path)
    return {name: field.get("/V") for name, field in (reader.get_fields() or {}).items()}


def fill(path: str, values: dict, output: str) -> None:
    reader = PdfReader(path)
    writer = PdfWriter()
    writer.append(reader)
    for page in writer.pages:
        writer.update_page_form_field_values(page, values)
    with open(output, "wb") as handle:
        writer.write(handle)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--values", help="JSON file with field values")
    parser.add_argument("--output", default="filled.pdf")
    args = parser.parse_args()
    if args.list:
        print(json.dumps(list_fields(args.pdf), indent=2))
    else:
        with open(args.values) as handle:
            fill(args.pdf, json.load(handle), args.output)
